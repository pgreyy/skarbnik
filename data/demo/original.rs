// The demo "original module": a tiny record parser with one hidden crash.
// It is compiled to WebAssembly by harness/checker/build_modules.sh.
//
// Input is a list of records. Each record is: tag (1 byte), length (1 byte), payload (length bytes).
//   tag 1 "int":  payload of 1 to 4 bytes, a little endian number
//   tag 2 "text": any payload bytes
//   tag 3 "list": payload[0] = item count n, then n two byte items
// The result is a fingerprint of everything parsed (0 or more), or a negative error code:
//   -1 truncated input, -2 unknown tag, -3 bad int length, -4 bad list.
//
// The bug: the list length check is off by one, so a list record whose length is exactly 2 * n
// reads one byte past its payload. That is an out of bounds access, which traps (crashes).
//
// Every byte read goes through `at`, which traps on an out of bounds index the same way Rust's
// own indexing does. It is written out by hand only to keep the module small: Rust's built in
// bounds check pulls in about 2 KB of panic message formatting code.
//
// How the harness talks to the module (the ABI):
//   input_buf() -> i32   address of a 256 byte buffer the harness writes the input into
//   parse(len: i32) -> i32   parses the first len bytes of that buffer
#![no_std]

const MAX_INPUT: usize = 256;
static mut INPUT: [u8; MAX_INPUT] = [0; MAX_INPUT];

#[no_mangle]
pub extern "C" fn input_buf() -> i32 {
    core::ptr::addr_of_mut!(INPUT) as i32
}

#[no_mangle]
pub extern "C" fn parse(len: i32) -> i32 {
    if len < 0 || len as usize > MAX_INPUT {
        return -1;
    }
    let input = unsafe { core::slice::from_raw_parts(core::ptr::addr_of!(INPUT) as *const u8, len as usize) };
    parse_records(input)
}

fn at(p: &[u8], i: usize) -> u8 {
    match p.get(i) {
        Some(b) => *b,
        None => core::arch::wasm32::unreachable(),
    }
}

fn mix(h: u32, v: u32) -> u32 {
    (h ^ v).wrapping_mul(16_777_619)
}

fn parse_records(input: &[u8]) -> i32 {
    let mut h: u32 = 0x811c_9dc5;
    let mut count: u32 = 0;
    let mut pos = 0usize;
    while pos < input.len() {
        if input.len() - pos < 2 {
            return -1;
        }
        let tag = at(input, pos);
        let len = at(input, pos + 1) as usize;
        pos += 2;
        if input.len() - pos < len {
            return -1;
        }
        let p = match input.get(pos..pos + len) {
            Some(p) => p,
            None => core::arch::wasm32::unreachable(),
        };
        pos += len;
        h = mix(h, tag as u32);
        match tag {
            1 => {
                if len == 0 || len > 4 {
                    return -3;
                }
                let mut v: u32 = 0;
                for (i, b) in p.iter().enumerate() {
                    v |= (*b as u32) << (8 * i);
                }
                h = mix(h, v);
            }
            2 => {
                h = mix(h, len as u32);
                for b in p {
                    h = mix(h, *b as u32);
                }
            }
            3 => {
                if len == 0 {
                    return -4;
                }
                let n = at(p, 0) as usize;
                // BUG: should be `1 + 2 * n > len`. This lets len == 2 * n through.
                if 1 + 2 * n > len + 1 {
                    return -4;
                }
                h = mix(h, n as u32);
                for i in 0..n {
                    let item = (at(p, 1 + 2 * i) as u32) | ((at(p, 2 + 2 * i) as u32) << 8);
                    h = mix(h, item);
                }
            }
            _ => return -2,
        }
        count += 1;
    }
    (mix(h, count) & 0x7fff_ffff) as i32
}

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}
