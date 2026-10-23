//! Hello world zkVM guest for spike S0. It reads a name from the host, and publishes
//! "hello, <name>" in the journal (the public output of the proof).

use risc0_zkvm::guest::env;

fn main() {
    let name: String = env::read();
    let greeting = format!("hello, {name}");
    env::commit(&greeting);
}
