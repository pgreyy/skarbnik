// Build script: compiles the zkVM guests (harness/guest: hello world; harness/check-guest: the patch checker) and
// writes each one's ELF and image id into the harness crate. The guests are built inside RISC Zero's guest builder
// Docker image (reproducible build), with the repository root mounted at a fixed folder, so the image id does not
// depend on where the repository sits or which user builds it. Needs Docker with the buildx plugin.
//
// Prebuilt mode, for a machine without Docker (the rented GPU pod): if KINTSUGI_PREBUILT_GUESTS names a folder that
// holds `hello_guest.bin` and `check_guest.bin` (the guest files a reproducible build wrote, copied from another
// machine; see scripts/export_guests.sh), those files are embedded as they are and their image ids are computed from
// their bytes. Nothing is compiled for the guest, so the ids are the ones of the machine that built the files.
use std::{collections::HashMap, env, fmt::Write as _, fs, path::PathBuf};

use risc0_build::{embed_methods_with_options, DockerOptionsBuilder, GuestOptions, GuestOptionsBuilder};

// The guest builder image tag: Rust 1.97.0, the same guest toolchain version as the local rzup install.
const BUILDER_TAG: &str = "r0.1.97.0";
const GUESTS: [&str; 2] = ["hello_guest", "check_guest"];

fn reproducible(root: &PathBuf) -> GuestOptions {
    let docker = DockerOptionsBuilder::default()
        .root_dir(root.clone())
        .docker_container_tag(BUILDER_TAG)
        .build()
        .expect("docker options");
    GuestOptionsBuilder::default().use_docker(docker).build().expect("guest options")
}

fn embed_prebuilt(dir: &str) {
    let mut out = String::new();
    for name in GUESTS {
        let path = fs::canonicalize(PathBuf::from(dir).join(format!("{name}.bin")))
            .unwrap_or_else(|e| panic!("KINTSUGI_PREBUILT_GUESTS: {name}.bin not found in {dir}: {e}"));
        let bytes = fs::read(&path).expect("read prebuilt guest");
        let id = risc0_binfmt::compute_image_id(&bytes).expect("image id of prebuilt guest");
        let upper = name.to_uppercase();
        let path = path.to_str().expect("utf-8 path");
        assert!(!path.contains('#'), "guest path cannot contain #");
        writeln!(out, "pub const {upper}_ELF: &[u8] = include_bytes!({path:?});").unwrap();
        writeln!(out, "pub const {upper}_PATH: &str = {path:?};").unwrap();
        writeln!(out, "pub const {upper}_ID: [u32; 8] = {:?};", id.as_words()).unwrap();
        println!("cargo:warning=prebuilt guest {name}: image id {id}");
        println!("cargo:rerun-if-changed={path}");
    }
    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));
    fs::write(out_dir.join("methods.rs"), out).expect("write methods.rs");
}

fn main() {
    println!("cargo:rerun-if-env-changed=KINTSUGI_PREBUILT_GUESTS");
    if let Ok(dir) = env::var("KINTSUGI_PREBUILT_GUESTS") {
        embed_prebuilt(&dir);
        return;
    }
    let root = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("repository root")
        .to_path_buf();
    embed_methods_with_options(HashMap::from(GUESTS.map(|name| (name, reproducible(&root)))));
}
