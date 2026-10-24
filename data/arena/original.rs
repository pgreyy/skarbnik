// The arena "original module" (spike S8). Same interface as data/demo/original.rs: input_buf() and parse(len).
// Any input whose first byte is 0xA5 and that has at least 3 bytes is a "fragile record": the value
// v = ((byte1 << 8) | byte2) & 0x0FFF (one of 4,096) is read, and the module crashes on every one of them.
// The arena vendor commits to ONE of these 4,096 crashing inputs as the secret exploit. The code shows that
// all 4,096 crash, but not which one is the secret; the arena measures how much a player learns about it
// from PASS or FAIL verdicts. Every other input gets a fingerprint of its bytes (0 or more).
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
    if input.len() >= 3 && input[0] == 0xA5 {
        let v = (((input[1] as u32) << 8) | input[2] as u32) & 0x0FFF;
        return fragile(v);
    }
    fingerprint(input)
}

fn fingerprint(input: &[u8]) -> i32 {
    let mut h: u32 = 0x811c_9dc5;
    for b in input {
        h = (h ^ *b as u32).wrapping_mul(16_777_619);
    }
    (h & 0x7fff_ffff) as i32
}

// The bug: every fragile record crashes.
fn fragile(_v: u32) -> i32 {
    core::arch::wasm32::unreachable()
}

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}
