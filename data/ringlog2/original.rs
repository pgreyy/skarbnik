// An event log kept in a ring of 16 one-byte slots. It is compiled to WebAssembly with plain rustc (see BUILD.txt, the
// same flags as the other programs).
//
// The input is a list of operations, one byte each: the top two bits say what to do, the low six bits (b) say how much.
//   00 b   append: write the value b at the write position, then move the write position on by one slot
//   01 b   skip: n = 1 + b % 3; clear the next n slots, then move the write position on by n slots
//   10 b   read: k = 1 + b % 16; add up the last k values written and fold the sum into the result
//   11 b   append the value 64 + b
// The write position runs round the ring: after the last slot comes the first one again. The ring is kept at a fixed
// place, the last 32 bytes of the module's memory (BUILD.txt sets 128 KiB): 16 slots, then 16 spare bytes. Each run
// starts on fresh memory, so they start cleared.
// The result is a fingerprint of every read, the number of operations and the final write position.
//
// How the harness talks to the module:
//   input_buf() -> i32   address of a 256 byte buffer the harness writes the input into
//   parse(len: i32) -> i32   runs the operations in the first len bytes of that buffer
#![no_std]

const MAX_INPUT: usize = 256;
const RING: usize = 16;
const RING_AT: usize = 0x1_ffe0; // 16 slots and 16 spare bytes, the last 32 bytes of memory
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
    run(input)
}

fn byte(p: &[u8], i: usize) -> u8 {
    match p.get(i) {
        Some(b) => *b,
        None => core::arch::wasm32::unreachable(),
    }
}

fn put(i: usize, v: u8) {
    unsafe { core::ptr::write_volatile((RING_AT + i) as *mut u8, v) }
}

fn get(i: usize) -> u8 {
    unsafe { core::ptr::read_volatile((RING_AT + i) as *const u8) }
}

struct Log {
    head: usize,
}

impl Log {
    // the slot after moving n slots on from the write position, round the ring
    fn advance(&self, n: usize) -> usize {
        let next = self.head + n;
        if next == RING {
            0
        } else {
            next
        }
    }

    fn append(&mut self, v: u8) {
        put(self.head, v);
        self.head = self.advance(1);
    }

    fn skip(&mut self, n: usize) {
        for i in 0..n {
            put((self.head + i) % RING, 0);
        }
        self.head = self.advance(n);
    }

    fn sum_last(&self, k: usize) -> u32 {
        let mut sum: u32 = 0;
        for j in 1..=k {
            sum += get((self.head + RING - j) % RING) as u32;
        }
        sum
    }
}

fn mix(f: u32, x: u32) -> u32 {
    (f ^ x).wrapping_mul(16_777_619)
}

fn run(input: &[u8]) -> i32 {
    let mut log = Log { head: 0 };
    let mut f: u32 = 0x811c_9dc5;
    let mut ops: u32 = 0;
    let mut at = 0usize;
    while at < input.len() {
        let op = byte(input, at);
        let b = (op & 0x3f) as usize;
        match op >> 6 {
            0 => log.append(b as u8),
            1 => log.skip(1 + b % 3),
            2 => f = mix(f, log.sum_last(1 + b % RING)),
            _ => log.append(64 + b as u8),
        }
        ops += 1;
        at += 1;
    }
    f = mix(f, ops);
    (mix(f, log.head as u32) & 0x7fff_ffff) as i32
}

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}
