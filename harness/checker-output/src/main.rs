//! skarbnik-check-output: the native command line tool of the output checker (src/lib.rs). It reads the files and
//! prints the verdict; the internal reason only with --explain. The secret file holds one line in the public test
//! format, "<input as hex> <expected value>", and stays outside the repository except for public demo secrets.
//!   check  --candidate F --original F --tests F --secret F --reference-fix F --seed HEX [--fuzz-count N] [--variants N] [--explain]
//!   proof0 --original F --tests F --secret F --reference-fix F --seed HEX [--fuzz-count N] [--variants N]
//!   run    --module F --input HEX
//!   table  --manifest F --original F --tests F --secret F --reference-fix F --seed HEX   (every module and its expected verdict)
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use kintsugi_check::{text, Limits, Loaded, Outcome, Round, TestCase, Verdict};
use kintsugi_check_output::{check_report, proof0_report, OutputBounty, Reason, Report};

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
}

fn read(p: &Path) -> Result<Vec<u8>, String> {
    std::fs::read(p).map_err(|e| format!("cannot read {}: {e}", p.display()))
}

struct Setup {
    original: Vec<u8>,
    tests: Vec<TestCase>,
    secret: TestCase,
    reference_fix: Vec<u8>,
}

impl Setup {
    fn load(args: &Args) -> Result<Setup, String> {
        let tests_text = String::from_utf8(read(Path::new(&args.need("tests")?))?).map_err(|_| "tests are not text")?;
        let secret_text = String::from_utf8(read(Path::new(&args.need("secret")?))?).map_err(|_| "secret is not text")?;
        let mut secret = text::parse_tests(&secret_text)?;
        if secret.len() != 1 {
            return Err("the secret file must hold exactly one line: <input as hex> <expected value>".into());
        }
        Ok(Setup {
            original: read(Path::new(&args.need("original")?))?,
            tests: text::parse_tests(&tests_text)?,
            secret: secret.remove(0),
            reference_fix: read(Path::new(&args.need("reference-fix")?))?,
        })
    }
    fn bounty(&self) -> OutputBounty<'_> {
        OutputBounty {
            original: &self.original,
            secret_input: &self.secret.input,
            expected: self.secret.expected,
            reference_fix: &self.reference_fix,
            public_tests: &self.tests,
        }
    }
}

fn round(args: &Args) -> Result<Round, String> {
    Ok(Round {
        fuzz_seed: text::parse_seed(&args.need("seed")?)?,
        fuzz_count: args.get("fuzz-count", "64").parse().map_err(|_| "--fuzz-count is a number")?,
        variant_count: args.get("variants", "64").parse().map_err(|_| "--variants is a number")?,
    })
}

fn outcome(o: &Outcome) -> String {
    match o {
        Outcome::Returned(v) => format!("returned {v}"),
        Outcome::Trapped { out_of_fuel, .. } => if *out_of_fuel { "out of fuel".into() } else { "trapped".into() },
    }
}

fn reason(r: &Option<Reason>) -> String {
    match r {
        None => "none".into(),
        Some(Reason::SecretWrong { expected, actual }) => format!("{}: expected {expected}, got {}", "2 secret", outcome(actual)),
        Some(Reason::FairnessMismatch { index, reference, candidate }) => {
            format!("4 fairness: input {index}, reference fix {}, candidate {}", outcome(reference), outcome(candidate))
        }
        Some(Reason::VariantMismatch { index, reference, candidate }) => {
            format!("5 variants: variant {index}, reference fix {}, candidate {}", outcome(reference), outcome(candidate))
        }
        Some(r) => r.step().to_string(),
    }
}

fn verdict_code(rep: &Report) -> ExitCode {
    if rep.verdict == Verdict::Pass { ExitCode::SUCCESS } else { ExitCode::from(1) }
}

fn cmd_check(args: &Args) -> Result<ExitCode, String> {
    let setup = Setup::load(args)?;
    let candidate = read(Path::new(&args.need("candidate")?))?;
    let rep = check_report(&candidate, &setup.bounty(), &round(args)?, &Limits::default());
    println!("{}", rep.verdict.as_str());
    if args.0.contains_key("explain") {
        println!("reason (internal): {}", reason(&rep.reason));
        println!("runs: {}", rep.runs);
    }
    Ok(verdict_code(&rep))
}

fn cmd_proof0(args: &Args) -> Result<ExitCode, String> {
    let setup = Setup::load(args)?;
    let rep = proof0_report(&setup.bounty(), &round(args)?, &Limits::default());
    println!("proof0: {}", rep.verdict.as_str());
    println!("reason (internal): {}", reason(&rep.reason));
    println!("runs: {}", rep.runs);
    Ok(verdict_code(&rep))
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
    let manifest = PathBuf::from(args.need("manifest")?);
    let dir = manifest.parent().unwrap_or(Path::new(".")).to_path_buf();
    let text = String::from_utf8(read(&manifest)?).map_err(|_| "manifest is not text")?;
    let (mut total, mut matched) = (0, 0);
    println!("| module | expected | got | step |");
    println!("| --- | --- | --- | --- |");
    for line in text.lines() {
        let line = line.split('#').next().unwrap_or("").trim();
        if line.is_empty() {
            continue;
        }
        let mut parts = line.split_whitespace();
        let (path, want) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));
        let module = read(&dir.join(path))?;
        let rep = check_report(&module, &setup.bounty(), &round, &Limits::default());
        total += 1;
        if rep.verdict.as_str() == want {
            matched += 1;
        }
        println!("| `{path}` | {want} | {} | {} |", rep.verdict.as_str(), reason(&rep.reason));
    }
    println!("\n{matched} of {total} match.");
    Ok(if matched == total { ExitCode::SUCCESS } else { ExitCode::from(1) })
}

fn main() -> ExitCode {
    let raw: Vec<String> = std::env::args().skip(1).collect();
    let Some(cmd) = raw.first().cloned() else {
        eprintln!("usage: skarbnik-check-output check|proof0|run|table ...");
        return ExitCode::from(2);
    };
    let result = Args::parse(&raw[1..]).and_then(|args| match cmd.as_str() {
        "check" => cmd_check(&args),
        "proof0" => cmd_proof0(&args),
        "run" => cmd_run(&args),
        "table" => cmd_table(&args),
        _ => Err(format!("unknown command {cmd}")),
    });
    match result {
        Ok(code) => code,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::from(2)
        }
    }
}
