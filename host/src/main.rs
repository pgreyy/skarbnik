//! Hello world host for spike S0. It sends a name into the zkVM guest, proves the run,
//! prints the journal and the image id, then verifies the receipt against that image id.
//! Proving uses the locally installed `r0vm` (RISC Zero's prover), not a remote service.

use std::time::Instant;

use kintsugi_harness::{HELLO_GUEST_ELF, HELLO_GUEST_ID};
use risc0_zkvm::{default_prover, sha::Digest, ExecutorEnv};

fn main() {
    let name = std::env::args().nth(1).unwrap_or_else(|| "kintsugi".to_string());

    let env = ExecutorEnv::builder()
        .write(&name)
        .expect("write input")
        .build()
        .expect("build executor env");

    let started = Instant::now();
    let prove_info = default_prover()
        .prove(env, HELLO_GUEST_ELF)
        .expect("proving failed");
    let prove_secs = started.elapsed().as_secs_f64();

    let receipt = prove_info.receipt;
    let journal: String = receipt.journal.decode().expect("decode journal");

    let started = Instant::now();
    receipt.verify(HELLO_GUEST_ID).expect("verification failed");
    let verify_secs = started.elapsed().as_secs_f64();

    println!("journal: {journal}");
    println!("image id: {}", Digest::from(HELLO_GUEST_ID));
    println!("total cycles: {}", prove_info.stats.total_cycles);
    println!("segments: {}", prove_info.stats.segments);
    println!("prove seconds: {prove_secs:.2}");
    println!("verify seconds: {verify_secs:.3}");
    println!("verified: true");
}
