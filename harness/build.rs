// Build script: compiles the zkVM guests (harness/guest: hello world; harness/check-guest: the patch checker) and
// writes each one's ELF and image id into the harness crate. The guests are built inside RISC Zero's guest builder
// Docker image (reproducible build), with the repository root mounted at a fixed folder, so the image id does not
// depend on where the repository sits or which user builds it. Needs Docker with the buildx plugin.
use std::{collections::HashMap, env, path::PathBuf};

use risc0_build::{embed_methods_with_options, DockerOptionsBuilder, GuestOptions, GuestOptionsBuilder};

// The guest builder image tag: Rust 1.97.0, the same guest toolchain version as the local rzup install.
const BUILDER_TAG: &str = "r0.1.97.0";

fn reproducible(root: &PathBuf) -> GuestOptions {
    let docker = DockerOptionsBuilder::default()
        .root_dir(root.clone())
        .docker_container_tag(BUILDER_TAG)
        .build()
        .expect("docker options");
    GuestOptionsBuilder::default().use_docker(docker).build().expect("guest options")
}

fn main() {
    let root = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("repository root")
        .to_path_buf();
    embed_methods_with_options(HashMap::from([
        ("hello_guest", reproducible(&root)),
        ("check_guest", reproducible(&root)),
    ]));
}
