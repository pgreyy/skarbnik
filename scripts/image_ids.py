# Prints the image ids that risc0-build wrote into a methods.rs file (one line per guest), in the same hex form as
# `skarbnik-host verify` prints them (each u32 word as 4 little-endian bytes). Usage: python3 scripts/image_ids.py <methods.rs>
import re, struct, sys
src = open(sys.argv[1]).read()
for name, words in re.findall(r"pub const (\w+_ID): \[u32; 8\] = \[([^\]]*)\]", src):
    nums = [int(w.strip()) for w in words.split(",") if w.strip()]
    print(name, b"".join(struct.pack("<I", n) for n in nums).hex())
