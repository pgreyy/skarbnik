//! skarbnik-check-rule: the native command line tool of the rule checker (src/lib.rs). It reads the files and prints the
//! verdict; the internal reason only with --explain. A sequence is hex: for each call the op, the argument length and
//! the arguments. The secret file holds one line, "<sequence as hex> [sweep=<p>,<p>]", outside the repository except
//! for public demo secrets.
//!   run     --module F --sequence HEX                 the transcript of one run
//!   expect  --module F --sequences F                  public test lines (sequence, transcript) from the original
//!   judge   --module F --rule F --sequence HEX        the rule's answer on one run
//!   check   --candidate F --original F --rule F --tests F --secret F --reference-fix F --seed HEX [--fuzz-count N] [--variants N] [--explain]
//!   proof0  --original F --rule F --tests F --secret F --reference-fix F --seed HEX [--fuzz-count N] [--variants N]
//!   table   --manifest F --original F --rule F --tests F --secret F --reference-fix F --seed HEX   (every module and its expected verdict)
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use kintsugi_check::{text, Round, Verdict};
use kintsugi_check_rule::*;

struct Args(HashMap<String, String>);

impl Args {
    fn parse(raw: &[String]) -> Result<Args, String> {
        let (mut map, mut i) = (HashMap::new(), 0);
        while i < raw.len() {
            let key = raw[i].strip_prefix("--").ok_or(format!("unexpected argument {}", raw[i]))?;
            if key == "explain" {
                map.insert(key.to_string(), String::new());
                i += 1;
                continue;
            }
            map.insert(key.to_string(), raw.get(i + 1).ok_or(format!("--{key} needs a value"))?.clone());
            i += 2;
        }
        Ok(Args(map))
    }
    fn get(&self, k: &str, d: &str) -> String {
        self.0.get(k).cloned().unwrap_or_else(|| d.to_string())
    }
    fn need(&self, k: &str) -> Result<String, String> {
        self.0.get(k).cloned().ok_or(format!("--{k} is required"))
    }
}

fn read(p: &str) -> Result<Vec<u8>, String> {
    std::fs::read(Path::new(p)).map_err(|e| format!("cannot read {p}: {e}"))
}
fn read_text(p: &str) -> Result<String, String> {
    String::from_utf8(read(p)?).map_err(|_| format!("{p} is not text"))
}
fn seq(h: &str) -> Result<Vec<Call>, String> {
    decode(&text::parse_hex(h)?).ok_or("the sequence is not a whole number of calls".into())
}

fn show(t: &Transcript) -> String {
    t.iter()
        .map(|r| match r {
            Result1::Returned { code, output } => format!("{code}:{}", String::from_utf8_lossy(output).replace(' ', "_")),
            Result1::Trapped { out_of_fuel } => if *out_of_fuel { "out_of_fuel".into() } else { "trapped".into() },
        })
        .collect::<Vec<_>>()
        .join(" ")
}

struct Setup {
    original: Vec<u8>,
    rule: Vec<u8>,
    tests: Vec<Test>,
    secret: Vec<u8>,
    sweep: Vec<u16>,
    fix: Vec<u8>,
}

impl Setup {
    fn load(a: &Args) -> Result<Setup, String> {
        let (secret, sweep) = parse_secret(&read_text(&a.need("secret")?)?)?;
        Ok(Setup {
            original: read(&a.need("original")?)?,
            rule: read(&a.need("rule")?)?,
            tests: parse_tests(&read_text(&a.need("tests")?)?)?,
            secret,
            sweep,
            fix: read(&a.need("reference-fix")?)?,
        })
    }
    fn bounty(&self) -> RuleBounty<'_> {
        RuleBounty { original: &self.original, rule: &self.rule, public_tests: &self.tests, secret: &self.secret, reference_fix: &self.fix, sweep_positions: &self.sweep }
    }
}

fn round(a: &Args) -> Result<Round, String> {
    Ok(Round {
        fuzz_seed: text::parse_seed(&a.need("seed")?)?,
        fuzz_count: a.get("fuzz-count", "64").parse().map_err(|_| "--fuzz-count is a number")?,
        variant_count: a.get("variants", "64").parse().map_err(|_| "--variants is a number")?,
    })
}

fn reason(r: &Option<Reason>) -> String {
    r.as_ref().map(|r| r.step()).unwrap_or_else(|| "none".into())
}

fn code(v: Verdict) -> ExitCode {
    if v == Verdict::Pass { ExitCode::SUCCESS } else { ExitCode::from(1) }
}

fn main() -> ExitCode {
    let raw: Vec<String> = std::env::args().skip(1).collect();
    let Some(cmd) = raw.first().cloned() else {
        eprintln!("usage: skarbnik-check-rule run|expect|judge|check|proof0|table ...");
        return ExitCode::from(2);
    };
    let limits = Limits::default();
    let result = Args::parse(&raw[1..]).and_then(|a| -> Result<ExitCode, String> {
        match cmd.as_str() {
            "run" => {
                let m = Loaded::program(&read(&a.need("module")?)?, &limits).map_err(|e| format!("load failed: {e:?}"))?;
                println!("{}", show(&m.run(&seq(&a.need("sequence")?)?, &limits)));
                Ok(ExitCode::SUCCESS)
            }
            "expect" => {
                let m = Loaded::program(&read(&a.need("module")?)?, &limits).map_err(|e| format!("load failed: {e:?}"))?;
                for line in read_text(&a.need("sequences")?)?.lines() {
                    let (body, note) = line.split_once('#').map(|(x, y)| (x.trim(), Some(y.trim()))).unwrap_or((line.trim(), None));
                    if body.is_empty() {
                        if let Some(n) = note { println!("# {n}"); }
                        continue;
                    }
                    let t = encode_transcript(&m.run(&seq(body)?, &limits));
                    let th = if t.is_empty() { "-".to_string() } else { t.iter().map(|b| format!("{b:02x}")).collect() };
                    println!("{body} {th}{}", note.map(|n| format!("   # {n}")).unwrap_or_default());
                }
                Ok(ExitCode::SUCCESS)
            }
            "judge" => {
                let m = Loaded::program(&read(&a.need("module")?)?, &limits).map_err(|e| format!("load failed: {e:?}"))?;
                let r = Loaded::rule(&read(&a.need("rule")?)?, &limits).map_err(|e| format!("rule load failed: {e:?}"))?;
                let calls = seq(&a.need("sequence")?)?;
                let t = m.run(&calls, &limits);
                println!("{} {}", if r.judge(&calls, &t, &limits) { "ok" } else { "violation" }, show(&t));
                Ok(ExitCode::SUCCESS)
            }
            "check" => {
                let s = Setup::load(&a)?;
                let rep = check_report(&read(&a.need("candidate")?)?, &s.bounty(), &round(&a)?, &limits);
                println!("{}", rep.verdict.as_str());
                if a.0.contains_key("explain") {
                    println!("reason (internal): {}", reason(&rep.reason));
                    println!("runs: {}", rep.runs);
                }
                Ok(code(rep.verdict))
            }
            "proof0" => {
                let s = Setup::load(&a)?;
                let rep = proof0_report(&s.bounty(), &round(&a)?, &limits);
                println!("proof0: {}", rep.verdict.as_str());
                println!("reason (internal): {}", reason(&rep.reason));
                println!("runs: {}", rep.runs);
                Ok(code(rep.verdict))
            }
            "table" => {
                let s = Setup::load(&a)?;
                let r = round(&a)?;
                let manifest = PathBuf::from(a.need("manifest")?);
                let dir = manifest.parent().unwrap_or(Path::new(".")).to_path_buf();
                let (mut total, mut matched) = (0, 0);
                println!("| module | expected | got | step |\n| --- | --- | --- | --- |");
                for line in read_text(manifest.to_str().unwrap_or(""))?.lines() {
                    let line = line.split('#').next().unwrap_or("").trim();
                    if line.is_empty() {
                        continue;
                    }
                    let mut p = line.split_whitespace();
                    let (path, want) = (p.next().unwrap_or(""), p.next().unwrap_or(""));
                    let rep = check_report(&read(dir.join(path).to_str().unwrap_or(""))?, &s.bounty(), &r, &limits);
                    total += 1;
                    matched += (rep.verdict.as_str() == want) as u32;
                    println!("| `{path}` | {want} | {} | {} |", rep.verdict.as_str(), reason(&rep.reason));
                }
                println!("\n{matched} of {total} match.");
                Ok(if matched == total { ExitCode::SUCCESS } else { ExitCode::from(1) })
            }
            _ => Err(format!("unknown command {cmd}")),
        }
    });
    match result {
        Ok(c) => c,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::from(2)
        }
    }
}
