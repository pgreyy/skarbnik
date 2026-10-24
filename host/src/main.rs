//! Host program for the zkVM guests. Commands (run from the repository root):
//!
//!   hello [name]                       prove and verify the S0 hello world guest
//!   execute <candidate.wasm> [opts]    run the checker guest without proving; prints cycles and segments
//!   prove   <candidate.wasm> [opts]    prove the checker guest; writes the receipt and prints timings and sizes
//!   verify  <receipt.bin>              verify a receipt file against the checker image id (exit 0 = valid, 1 = invalid)
//!   tamper  <in.bin> <out.bin> <journal|seal>   write a changed copy of a receipt, to show it no longer verifies
//!   compress <in.bin> <out.bin> <succinct|groth16>   compress a receipt to one proof and time it
//!                                      (groth16 needs Docker, or an NVIDIA GPU with the cuda feature)
//!   groth16-args <groth16 receipt.bin> <out.json>   write the values a contract needs to check a Groth16 receipt:
//!                                      the 256 byte seal, the image id, the journal, RISC Zero's control root and
//!                                      BN254 control id, and the claim digest (for cross-checking), all in hex
//!
//! Options for execute and prove: --fuzz-count N (default 64), --variants N (default 32),
//! --seed <64 hex chars> (default: the S1 demo seed), --succinct (prove only: compress to one succinct receipt),
//! --out <file> (prove only: receipt file, default target/s2/receipt.bin), --po2 N (segment size limit as a
//! power of two, smaller uses less memory per segment; default: RISC Zero's default of 20), --profile (execute
//! only: the guest prints its cycles per phase), --submission-id <64 hex> (the id the contract gives the submission,
//! see `get_submission_id`; default all zeros), --proof0 (Proof 0 mode: the candidate is the vendor's reference fix).
//! The bounty files are the demo files in data/demo/. Proving runs on this machine through the installed
//! r0vm; nothing is sent to a remote prover.

use std::process::ExitCode;
use std::time::Instant;

use kintsugi_check::text::{parse_hex, parse_seed, parse_tests, to_hex};
use kintsugi_check::zk::{GuestInput, Journal, VERDICT_FAIL, VERDICT_PASS};
use kintsugi_harness::{CHECK_GUEST_ELF, CHECK_GUEST_ID, HELLO_GUEST_ELF, HELLO_GUEST_ID};
use risc0_zkvm::{default_executor, default_prover, sha::Digest, ExecutorEnv, InnerReceipt, ProverOpts, Receipt};

/// The S1 demo seed ("kintsugi S1 demo seed A........!").
const DEMO_SEED: &str = "6b696e74737567692053312064656d6f207365656420412e2e2e2e2e2e2e2e21";
/// A fixed demo salt for the exploit commitment. A real vendor picks a random secret salt.
const DEMO_SALT: [u8; 32] = *b"kintsugi demo salt, not a secret";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        Some("hello") => hello(args.get(1).cloned().unwrap_or_else(|| "kintsugi".to_string())),
        Some("execute") => execute(&args[1..]),
        Some("prove") => prove(&args[1..]),
        Some("verify") => return verify(&args[1..]),
        Some("tamper") => tamper(&args[1..]),
        Some("compress") => compress(&args[1..]),
        Some("groth16-args") => groth16_args(&args[1..]),
        None => hello("kintsugi".to_string()),
        Some(other) => Err(format!("unknown command {other}; see the comment at the top of host/src/main.rs")),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::from(2)
        }
    }
}

fn hello(name: String) -> Result<(), String> {
    let env = ExecutorEnv::builder().write(&name).map_err(|e| e.to_string())?.build().map_err(|e| e.to_string())?;
    let started = Instant::now();
    let prove_info = default_prover().prove(env, HELLO_GUEST_ELF).map_err(|e| e.to_string())?;
    let prove_secs = started.elapsed().as_secs_f64();
    let receipt = prove_info.receipt;
    let journal: String = receipt.journal.decode().map_err(|e| e.to_string())?;
    let started = Instant::now();
    receipt.verify(HELLO_GUEST_ID).map_err(|e| e.to_string())?;
    let verify_secs = started.elapsed().as_secs_f64();
    println!("journal: {journal}");
    println!("image id: {}", Digest::from(HELLO_GUEST_ID));
    println!("total cycles: {}", prove_info.stats.total_cycles);
    println!("segments: {}", prove_info.stats.segments);
    println!("prove seconds: {prove_secs:.2}");
    println!("verify seconds: {verify_secs:.3}");
    println!("verified: true");
    Ok(())
}

struct Opts {
    candidate: String,
    fuzz_count: u32,
    variants: u32,
    seed: [u8; 32],
    succinct: bool,
    out: String,
    po2: Option<u32>,
    profile: bool,
    submission_id: [u8; 32],
    proof0: bool,
}

fn parse_opts(args: &[String]) -> Result<Opts, String> {
    let candidate = args.first().cloned().ok_or("missing candidate.wasm")?;
    let mut opts = Opts {
        candidate,
        fuzz_count: 64,
        variants: 32,
        seed: parse_seed(DEMO_SEED)?,
        succinct: false,
        out: "target/s2/receipt.bin".to_string(),
        po2: None,
        profile: false,
        submission_id: [0u8; 32],
        proof0: false,
    };
    let mut i = 1;
    while i < args.len() {
        let value = || args.get(i + 1).ok_or(format!("{} needs a value", args[i]));
        match args[i].as_str() {
            "--fuzz-count" => opts.fuzz_count = value()?.parse().map_err(|e| format!("--fuzz-count: {e}"))?,
            "--variants" => opts.variants = value()?.parse().map_err(|e| format!("--variants: {e}"))?,
            "--seed" => opts.seed = parse_seed(value()?)?,
            "--out" => opts.out = value()?.clone(),
            "--submission-id" => opts.submission_id = parse_seed(value()?)?,
            "--po2" => opts.po2 = Some(value()?.parse().map_err(|e| format!("--po2: {e}"))?),
            "--succinct" => {
                opts.succinct = true;
                i += 1;
                continue;
            }
            "--profile" => {
                opts.profile = true;
                i += 1;
                continue;
            }
            "--proof0" => {
                opts.proof0 = true;
                i += 1;
                continue;
            }
            other => return Err(format!("unknown option {other}")),
        }
        i += 2;
    }
    Ok(opts)
}

fn read(path: &str) -> Result<Vec<u8>, String> {
    std::fs::read(path).map_err(|e| format!("{path}: {e}"))
}

fn guest_input(opts: &Opts) -> Result<GuestInput, String> {
    let exploit_text = String::from_utf8(read("data/demo/exploit.hex")?).map_err(|e| e.to_string())?;
    let tests_text = String::from_utf8(read("data/demo/public_tests.txt")?).map_err(|e| e.to_string())?;
    let tests = parse_tests(&tests_text)?;
    Ok(GuestInput {
        original: read("data/demo/original.wasm")?,
        exploit: parse_hex(exploit_text.trim())?,
        salt: DEMO_SALT,
        public_tests: tests.into_iter().map(|t| (t.input, t.expected)).collect(),
        candidate: read(&opts.candidate)?,
        fuzz_seed: opts.seed,
        fuzz_count: opts.fuzz_count,
        variant_count: opts.variants,
        submission_id: opts.submission_id,
        profile: opts.profile,
        mode: if opts.proof0 { kintsugi_check::zk::MODE_PROOF0 } else { kintsugi_check::zk::MODE_CHECK },
    })
}

fn env_for(input: &GuestInput, po2: Option<u32>) -> Result<ExecutorEnv<'static>, String> {
    let mut builder = ExecutorEnv::builder();
    builder.write(input).map_err(|e| e.to_string())?;
    if let Some(p) = po2 {
        builder.segment_limit_po2(p);
    }
    builder.build().map_err(|e| e.to_string())
}

fn verdict_str(v: u8) -> &'static str {
    match v {
        VERDICT_PASS => "PASS",
        VERDICT_FAIL => "FAIL",
        _ => "INVALID",
    }
}

fn print_journal(j: &Journal) {
    println!("journal.verdict: {}", verdict_str(j.verdict));
    println!("journal.candidate_hash: {}", to_hex(&j.candidate_hash));
    println!("journal.original_hash: {}", to_hex(&j.original_hash));
    println!("journal.exploit_commitment: {}", to_hex(&j.exploit_commitment));
    println!("journal.corpus_hash: {}", to_hex(&j.corpus_hash));
    println!("journal.fuzz_seed: {}", to_hex(&j.fuzz_seed));
    println!("journal.fuzz_count: {}", j.fuzz_count);
    println!("journal.variant_count: {}", j.variant_count);
    println!("journal.submission_id: {}", to_hex(&j.submission_id));
}

fn execute(args: &[String]) -> Result<(), String> {
    let opts = parse_opts(args)?;
    let input = guest_input(&opts)?;
    let started = Instant::now();
    let session = default_executor().execute(env_for(&input, opts.po2)?, CHECK_GUEST_ELF).map_err(|e| e.to_string())?;
    let secs = started.elapsed().as_secs_f64();
    let journal: Journal = session.journal.decode().map_err(|e| e.to_string())?;
    println!("candidate: {}", opts.candidate);
    println!("image id: {}", Digest::from(CHECK_GUEST_ID));
    println!("fuzz_count: {} variants: {}", opts.fuzz_count, opts.variants);
    println!("user cycles: {}", session.cycles());
    println!("segments: {}", session.segments.len());
    println!("segment po2: {:?}", session.segments.iter().map(|s| s.po2).collect::<Vec<_>>());
    println!("padded cycles (sum of 2^po2, the work a proof must cover): {}", session.segments.iter().map(|s| 1u64 << s.po2).sum::<u64>());
    println!("execute seconds: {secs:.2}");
    print_journal(&journal);
    Ok(())
}

fn prove(args: &[String]) -> Result<(), String> {
    let opts = parse_opts(args)?;
    let input = guest_input(&opts)?;
    let prover_opts = if opts.succinct { ProverOpts::succinct() } else { ProverOpts::composite() };
    let started = Instant::now();
    let info = default_prover()
        .prove_with_opts(env_for(&input, opts.po2)?, CHECK_GUEST_ELF, &prover_opts)
        .map_err(|e| e.to_string())?;
    let prove_secs = started.elapsed().as_secs_f64();
    let receipt = info.receipt;

    let started = Instant::now();
    receipt.verify(CHECK_GUEST_ID).map_err(|e| format!("verification failed: {e}"))?;
    let verify_secs = started.elapsed().as_secs_f64();

    let bytes = bincode::serialize(&receipt).map_err(|e| e.to_string())?;
    if let Some(dir) = std::path::Path::new(&opts.out).parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&opts.out, &bytes).map_err(|e| format!("{}: {e}", opts.out))?;
    let seal_words = match &receipt.inner {
        InnerReceipt::Composite(c) => c.segments.iter().map(|s| s.seal.len()).sum::<usize>(),
        InnerReceipt::Succinct(s) => s.seal.len(),
        _ => 0,
    };
    let journal: Journal = receipt.journal.decode().map_err(|e| e.to_string())?;

    println!("candidate: {}", opts.candidate);
    println!("image id: {}", Digest::from(CHECK_GUEST_ID));
    println!("receipt kind: {}", if opts.succinct { "succinct" } else { "composite" });
    println!("segment po2 limit: {}", opts.po2.map(|p| p.to_string()).unwrap_or_else(|| "default".to_string()));
    println!("fuzz_count: {} variants: {}", opts.fuzz_count, opts.variants);
    println!("total cycles: {}", info.stats.total_cycles);
    println!("user cycles: {}", info.stats.user_cycles);
    println!("segments: {}", info.stats.segments);
    println!("prove seconds: {prove_secs:.2}");
    println!("verify seconds (in process): {verify_secs:.3}");
    println!("receipt file: {} ({} bytes)", opts.out, bytes.len());
    println!("seal bytes: {}", seal_words * 4);
    println!("journal bytes: {}", receipt.journal.bytes.len());
    print_journal(&journal);
    Ok(())
}

/// Separate process check: exit 0 if the receipt verifies against the checker image id, 1 if not.
fn verify(args: &[String]) -> ExitCode {
    let Some(path) = args.first() else {
        eprintln!("error: missing receipt file");
        return ExitCode::from(2);
    };
    let bytes = match read(path) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("error: {e}");
            return ExitCode::from(2);
        }
    };
    let receipt: Receipt = match bincode::deserialize(&bytes) {
        Ok(r) => r,
        Err(e) => {
            println!("INVALID: receipt file does not decode: {e}");
            return ExitCode::from(1);
        }
    };
    let started = Instant::now();
    let result = receipt.verify(CHECK_GUEST_ID);
    let secs = started.elapsed().as_secs_f64();
    println!("receipt file: {path} ({} bytes)", bytes.len());
    println!("image id: {}", Digest::from(CHECK_GUEST_ID));
    println!("verify seconds: {secs:.3}");
    match result {
        Ok(()) => match receipt.journal.decode::<Journal>() {
            Ok(j) => {
                println!("VALID");
                let digest = <risc0_zkvm::sha::Impl as risc0_zkvm::sha::Sha256>::hash_bytes(&receipt.journal.bytes);
                println!("journal sha256: {}", to_hex(digest.as_bytes()));
                print_journal(&j);
                ExitCode::SUCCESS
            }
            Err(e) => {
                println!("INVALID: journal does not decode: {e}");
                ExitCode::from(1)
            }
        },
        Err(e) => {
            println!("INVALID: {e}");
            ExitCode::from(1)
        }
    }
}

/// Compresses a receipt (composite to succinct, or to Groth16), times it, verifies the result and writes it.
fn compress(args: &[String]) -> Result<(), String> {
    let [input, output, kind] = args else {
        return Err("usage: compress <in.bin> <out.bin> <succinct|groth16>".to_string());
    };
    let opts = match kind.as_str() {
        "succinct" => ProverOpts::succinct(),
        "groth16" => ProverOpts::groth16(),
        other => return Err(format!("unknown kind {other}")),
    };
    let in_bytes = read(input)?;
    let receipt: Receipt = bincode::deserialize(&in_bytes).map_err(|e| e.to_string())?;
    let started = Instant::now();
    let compressed = default_prover().compress(&opts, &receipt).map_err(|e| e.to_string())?;
    let secs = started.elapsed().as_secs_f64();
    let started = Instant::now();
    compressed.verify(CHECK_GUEST_ID).map_err(|e| format!("verification failed: {e}"))?;
    let verify_secs = started.elapsed().as_secs_f64();
    let out_bytes = bincode::serialize(&compressed).map_err(|e| e.to_string())?;
    std::fs::write(output, &out_bytes).map_err(|e| format!("{output}: {e}"))?;
    println!("input receipt: {input} ({} bytes)", in_bytes.len());
    println!("compressed to: {kind}");
    println!("compress seconds: {secs:.2}");
    println!("verify seconds: {verify_secs:.3}");
    println!("output receipt: {output} ({} bytes)", out_bytes.len());
    Ok(())
}

/// Writes a changed copy of a receipt. "journal": flips the published verdict (PASS <-> FAIL).
/// "seal": flips one bit in the proof itself.
fn tamper(args: &[String]) -> Result<(), String> {
    let [input, output, what] = args else {
        return Err("usage: tamper <in.bin> <out.bin> <journal|seal>".to_string());
    };
    let mut receipt: Receipt = bincode::deserialize(&read(input)?).map_err(|e| e.to_string())?;
    match what.as_str() {
        "journal" => {
            let mut j: Journal = receipt.journal.decode().map_err(|e| e.to_string())?;
            let before = verdict_str(j.verdict);
            j.verdict = if j.verdict == VERDICT_PASS { VERDICT_FAIL } else { VERDICT_PASS };
            receipt.journal.bytes = risc0_zkvm::serde::to_vec(&j)
                .map_err(|e| e.to_string())?
                .iter()
                .flat_map(|w| w.to_le_bytes())
                .collect();
            println!("journal verdict changed from {before} to {}", verdict_str(j.verdict));
        }
        "seal" => {
            let seal = match &mut receipt.inner {
                InnerReceipt::Composite(c) => &mut c.segments[0].seal,
                InnerReceipt::Succinct(s) => &mut s.seal,
                _ => return Err("unsupported receipt kind".to_string()),
            };
            let at = seal.len() / 2;
            seal[at] ^= 1;
            println!("flipped one bit in seal word {at} of {}", seal.len());
        }
        other => return Err(format!("unknown tamper target {other}")),
    }
    std::fs::write(output, bincode::serialize(&receipt).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    println!("wrote {output}");
    Ok(())
}

/// Writes the values a contract needs to check a Groth16 receipt, as hex in a JSON file. The verifier parameters
/// (control root, BN254 control id) are the ones `receipt.verify` uses by default, and the claim digest is RISC Zero's
/// own, so a contract's computation can be compared with it.
fn groth16_args(args: &[String]) -> Result<(), String> {
    use risc0_zkvm::sha::Digestible;
    let [input, out] = args else { return Err("usage: groth16-args <groth16 receipt.bin> <out.json>".into()) };
    let receipt: Receipt = bincode::deserialize(&read(input)?).map_err(|e| format!("receipt does not decode: {e}"))?;
    receipt.verify(CHECK_GUEST_ID).map_err(|e| format!("receipt does not verify: {e}"))?;
    let groth16 = receipt.inner.groth16().map_err(|e| format!("not a Groth16 receipt: {e}"))?;
    let ctx = risc0_zkvm::VerifierContext::default();
    let params = ctx.groth16_verifier_parameters.as_ref().ok_or("no Groth16 verifier parameters")?;
    let defaults = risc0_zkvm::Groth16ReceiptVerifierParameters::default();
    let claim = risc0_zkvm::ReceiptClaim::ok(Digest::from(CHECK_GUEST_ID), receipt.journal.bytes.clone());
    let hex = |b: &[u8]| b.iter().map(|x| format!("{x:02x}")).collect::<String>();
    let json = format!(
        "{{\"seal\":\"{}\",\"image_id\":\"{}\",\"journal\":\"{}\",\"control_root\":\"{}\",\"bn254_control_id\":\"{}\",\"claim_digest\":\"{}\",\"default_control_root\":\"{}\",\"default_bn254_control_id\":\"{}\"}}\n",
        hex(&groth16.seal),
        hex(Digest::from(CHECK_GUEST_ID).as_bytes()),
        hex(&receipt.journal.bytes),
        hex(params.control_root.as_bytes()),
        hex(params.bn254_control_id.as_bytes()),
        hex(claim.digest().as_bytes()),
        hex(defaults.control_root.as_bytes()),
        hex(defaults.bn254_control_id.as_bytes()),
    );
    std::fs::write(out, &json).map_err(|e| e.to_string())?;
    println!("seal bytes: {}", groth16.seal.len());
    println!("wrote {out}");
    Ok(())
}
