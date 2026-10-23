// Build script: compiles the zkVM guest in harness/guest with the RISC Zero toolchain
// and writes the guest's ELF and image id into the harness crate.
fn main() {
    risc0_build::embed_methods();
}
