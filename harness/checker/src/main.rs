//! Command line tool for the Kintsugi checker (spike S1). It reads the files, calls the pure
//! checker core in lib.rs, and prints the result. Run from the repository root.
//!
//! Commands:
//!   check  --candidate F --seed HEX [common options] [--explain]
//!          Prints PASS or FAIL. Exit code 0 for PASS, 1 for FAIL. --explain also prints the
//!          internal reason (for our own testing only; a published result carries only the verdict).
//!   proof0 [common options] [--reference-fix F --seed HEX]
//!          Checks that the original really crashes on the secret input and passes its tests. With
//!          --reference-fix it also checks that the vendor's reference fix passes the full check.
//!   run    --module F --input HEX
//!          Runs one module on one input and prints the outcome and fuel used.
//!   table  --manifest F --seed HEX [common options]
//!          Checks every module listed in the manifest and prints a table of expected vs actual.
//!          Exit code 0 only if every actual verdict equals the expected one.
//!
//! Common options (defaults in brackets):
//!   --original F    [data/demo/original.wasm]
//!   --exploit F     [data/demo/exploit.hex]  hex text file
//!   --tests F       [data/demo/public_tests.txt]
//!   --fuzz-count N  [64]
//!   --variants N    [32]  (0 turns the variants step off)

use kintsugi_check::{
    check_report, proof0_report, text, Bounty, Limits, Loaded, Outcome, Reason, Report, Round,
    TestCase,
};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::Instant;

fn usage() -> ExitCode {
    eprintln!("usage: kintsugi-check <check|proof0|run|table> [options]; see src/main.rs for the list");
    ExitCode::from(2)
}

struct Args(HashMap<String, String>);

impl Args {
    fn parse(raw: &[String]) -> Result<Args, String> {
        let mut map = HashMap::new();
        let mut i = 0;
        while i < raw.len() {
            let key = raw[i].strip_prefix("--").ok_or(format!("unexpected argument {}", raw[i]))?;
            if key == "explain" {
                map.insert(key.to_string(), String::new());
                i += 1;
                continue;
            }
            let val = raw.get(i + 1).ok_or(format!("--{key} needs a value"))?;
            map.insert(key.to_string(), val.clone());
            i += 2;
        }
        Ok(Args(map))
    }
    fn get(&self, key: &str, default: &str) -> String {
        self.0.get(key).cloned().unwrap_or_else(|| default.to_string())
    }
    fn need(&self, key: &str) -> Result<String, String> {
        self.0.get(key).cloned().ok_or(format!("--{key} is required"))
    }
    fn num(&self, key: &str, default: u32) -> Result<u32, String> {
        match self.0.get(key) {
            Some(v) => v.parse().map_err(|e| format!("--{key}: {e}")),
            None => Ok(default),
        }
    }
}

fn read(path: &Path) -> Result<Vec<u8>, String> {
    std::fs::read(path).map_err(|e| format!("cannot read {}: {e}", path.display()))
}

fn read_text(path: &Path) -> Result<String, String> {
    String::from_utf8(read(path)?).map_err(|_| format!("{} is not text", path.display()))
}

struct Setup {
    original: Vec<u8>,
    exploit: Vec<u8>,
    tests: Vec<TestCase>,
}

impl Setup {
    fn load(args: &Args) -> Result<Setup, String> {
        let original = read(Path::new(&args.get("original", "data/demo/original.wasm")))?;
        let exploit = text::parse_hex(&read_text(Path::new(&args.get("exploit", "data/demo/exploit.hex")))?)?;
        let tests = text::parse_tests(&read_text(Path::new(&args.get("tests", "data/demo/public_tests.txt")))?)?;
        Ok(Setup { original, exploit, tests })
    }
    fn bounty(&self) -> Bounty<'_> {
        Bounty { original: &self.original, exploit: &self.exploit, public_tests: &self.tests }
    }
}

fn round(args: &Args) -> Result<Round, String> {
    Ok(Round {
        fuzz_seed: text::parse_seed(&args.need("seed")?)?,
        fuzz_count: args.num("fuzz-count", 64)?,
        variant_count: args.num("variants", 32)?,
    })
}

fn outcome(o: &Outcome) -> String {
    match o {
        Outcome::Returned(v) => format!("returned {v}"),
        Outcome::Trapped { out_of_fuel: true, .. } => "ran out of fuel".into(),
        Outcome::Trapped { detail, .. } => format!("trapped ({detail})"),
    }
}

/// Internal reason in one line. Never printed for the exploit's bytes.
fn reason(r: &Option<Reason>) -> String {
    let Some(r) = r else { return "-".into() };
    let detail = match r {
        Reason::OriginalInvalid(e) | Reason::CandidateInvalid(e) => format!("{e:?}"),
        Reason::ExploitStillFails(o) => outcome(o),
        Reason::PublicTestMismatch { index, expected, actual } => {
            format!("test #{index}: expected {expected}, {}", outcome(actual))
        }
        Reason::FairnessMismatch { index, input, original, candidate } => format!(
            "input #{index} ({}): original {}, candidate {}",
            text::to_hex(input),
            outcome(original),
            outcome(candidate)
        ),
        Reason::VariantMismatch { index, original, candidate } => {
            format!("variant #{index}: original {}, candidate {}", outcome(original), outcome(candidate))
        }
        Reason::OriginalDoesNotCrash(o) => outcome(o),
        Reason::OriginalOnlyRanOutOfFuel => "ran out of fuel instead of crashing".into(),
        Reason::OriginalFailsPublicTest { index, expected, actual } => {
            format!("test #{index}: expected {expected}, {}", outcome(actual))
        }
        Reason::ExploitTooLong { len, max } => format!("{len} bytes, at most {max} allowed"),
        Reason::ReferenceFixFails(inner) => reason(&Some((**inner).clone())),
    };
    format!("{}: {}", r.step(), detail)
}

fn print_stats(rep: &Report) {
    let s = &rep.stats;
    println!(
        "stats: runs={} max_fuel_candidate={} max_fuel_original={} fairness_original_traps={} fairness_original_errors={} variants_original_traps={}",
        s.runs, s.max_fuel_candidate, s.max_fuel_original, s.fairness_original_traps,
        s.fairness_original_errors, s.variants_original_traps
    );
}

fn cmd_check(args: &Args) -> Result<ExitCode, String> {
    let setup = Setup::load(args)?;
    let candidate = read(Path::new(&args.need("candidate")?))?;
    let rep = check_report(&candidate, &setup.bounty(), &round(args)?, &Limits::default());
    println!("{}", rep.verdict.as_str());
    if args.0.contains_key("explain") {
        println!("reason (internal): {}", reason(&rep.reason));
        print_stats(&rep);
    }
    Ok(if rep.verdict == kintsugi_check::Verdict::Pass { ExitCode::SUCCESS } else { ExitCode::from(1) })
}

fn cmd_proof0(args: &Args) -> Result<ExitCode, String> {
    let setup = Setup::load(args)?;
    let rep = match args.0.get("reference-fix") {
        Some(f) => {
            let fix = read(Path::new(f))?;
            kintsugi_check::proof0_with_reference(&setup.bounty(), &round(args)?, &Limits::default(), &fix)
        }
        None => proof0_report(&setup.bounty(), &Limits::default()),
    };
    println!("proof0: {}", rep.verdict.as_str());
    println!("reason (internal): {}", reason(&rep.reason));
    print_stats(&rep);
    Ok(if rep.verdict == kintsugi_check::Verdict::Pass { ExitCode::SUCCESS } else { ExitCode::from(1) })
}

fn cmd_run(args: &Args) -> Result<ExitCode, String> {
    let module = read(Path::new(&args.need("module")?))?;
    let input = text::parse_hex(&args.get("input", ""))?;
    let loaded = Loaded::load(&module, &Limits::default()).map_err(|e| format!("load failed: {e:?}"))?;
    let r = loaded.run(&input);
    println!("{} fuel_used={}", outcome(&r.outcome), r.fuel_used);
    Ok(ExitCode::SUCCESS)
}

fn cmd_table(args: &Args) -> Result<ExitCode, String> {
    let setup = Setup::load(args)?;
    let round = round(args)?;
    let manifest_path = PathBuf::from(args.need("manifest")?);
    let dir = manifest_path.parent().unwrap_or(Path::new(".")).to_path_buf();
    let manifest = read_text(&manifest_path)?;
    println!(
        "seed={} fuzz_count={} variants={}",
        text::to_hex(&round.fuzz_seed),
        round.fuzz_count,
        round.variant_count
    );
    println!();
    println!("| patch | expected verdict | actual verdict | match | reason (internal) | runs | max fuel | ms |");
    println!("| --- | --- | --- | --- | --- | --- | --- | --- |");
    let (mut total, mut matched) = (0, 0);
    for line in manifest.lines() {
        let line = line.split('#').next().unwrap_or("").trim();
        if line.is_empty() {
            continue;
        }
        let mut parts = line.split_whitespace();
        let (Some(file), Some(expected)) = (parts.next(), parts.next()) else {
            return Err(format!("bad manifest line: {line}"));
        };
        let module = read(&dir.join(file))?;
        let started = Instant::now();
        let rep = check_report(&module, &setup.bounty(), &round, &Limits::default());
        let ms = started.elapsed().as_secs_f64() * 1000.0;
        let actual = rep.verdict.as_str();
        let ok = actual == expected;
        total += 1;
        if ok {
            matched += 1;
        }
        println!(
            "| {file} | {expected} | {actual} | {} | {} | {} | {} | {ms:.1} |",
            if ok { "yes" } else { "NO" },
            reason(&rep.reason).replace('|', "/"),
            rep.stats.runs,
            rep.stats.max_fuel_candidate
        );
    }
    println!();
    println!("{matched} of {total} verdicts match the expected verdict");
    Ok(if matched == total { ExitCode::SUCCESS } else { ExitCode::from(1) })
}

fn main() -> ExitCode {
    let raw: Vec<String> = std::env::args().skip(1).collect();
    let Some(cmd) = raw.first() else { return usage() };
    let args = match Args::parse(&raw[1..]) {
        Ok(a) => a,
        Err(e) => {
            eprintln!("error: {e}");
            return usage();
        }
    };
    let result = match cmd.as_str() {
        "check" => cmd_check(&args),
        "proof0" => cmd_proof0(&args),
        "run" => cmd_run(&args),
        "table" => cmd_table(&args),
        _ => return usage(),
    };
    match result {
        Ok(code) => code,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::from(2)
        }
    }
}
