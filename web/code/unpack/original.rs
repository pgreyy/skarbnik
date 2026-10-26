// A small decoder for a packed byte format. It is compiled to WebAssembly with plain rustc (see BUILD.txt).
//
// The input is a list of commands. Each command starts with one byte c:
//   c < 0x80   literal: the next c + 1 input bytes are added to the output
//   c >= 0x80  copy: one more input byte d follows; (c - 0x80) + 3 bytes are added to the output, one at a time,
//              each taken from d bytes back from the end of the output
// The output holds at most 200 bytes.
// The result is a fingerprint of the output (0 or more), or a negative error code:
//   -1 the input ends inside a command, -2 the output would hold more than 200 bytes, -3 a copy goes back further
//   than the output.
//
// How the harness talks to the module:
//   input_buf() -> i32   address of a 256 byte buffer the harness writes the input into
//   parse(len: i32) -> i32   decodes the first len bytes of that buffer
#![no_std]

const MAX_INPUT: usize = 256;
const MAX_OUTPUT: usize = 200;
static mut INPUT: [u8; MAX_INPUT] = [0; MAX_INPUT];
static mut OUTPUT: [u8; MAX_OUTPUT] = [0; MAX_OUTPUT];

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
    let output = unsafe { &mut *core::ptr::addr_of_mut!(OUTPUT) };
    decode(input, output)
}

fn at(p: &[u8], i: usize) -> u8 {
    match p.get(i) {
        Some(b) => *b,
        None => core::arch::wasm32::unreachable(),
    }
}

fn put(out: &mut [u8], i: usize, b: u8) {
    match out.get_mut(i) {
        Some(x) => *x = b,
        None => core::arch::wasm32::unreachable(),
    }
}

fn first(out: &[u8], n: usize) -> &[u8] {
    match out.get(..n) {
        Some(p) => p,
        None => core::arch::wasm32::unreachable(),
    }
}

fn decode(input: &[u8], out: &mut [u8; MAX_OUTPUT]) -> i32 {
    let mut n = 0usize;
    let mut pos = 0usize;
    while pos < input.len() {
        let c = at(input, pos) as usize;
        pos += 1;
        if c < 0x80 {
            let count = c + 1;
            if input.len() - pos < count {
                return -1;
            }
            if n + count > MAX_OUTPUT {
                return -2;
            }
            for i in 0..count {
                put(out, n, at(input, pos + i));
                n += 1;
            }
            pos += count;
        } else {
            if pos >= input.len() {
                return -1;
            }
            let d = at(input, pos) as usize;
            pos += 1;
            let count = c - 0x80 + 3;
            if d > n {
                return -3;
            }
            if n + count > MAX_OUTPUT {
                return -2;
            }
            for _ in 0..count {
                let b = at(first(out, n), n - d);
                put(out, n, b);
                n += 1;
            }
        }
    }
    let mut h: u32 = 0x811c_9dc5;
    for b in first(out, n) {
        h = (h ^ *b as u32).wrapping_mul(16_777_619);
    }
    ((h ^ n as u32).wrapping_mul(16_777_619) & 0x7fff_ffff) as i32
}

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}
