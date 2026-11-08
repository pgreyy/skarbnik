// Output checker corpus: a correct fix written another way, one formula for every total. A patch of data/feecalc/original.rs; expected verdict in manifest.txt.
// A fee calculator. It is compiled to WebAssembly with plain rustc (see BUILD.txt, the same flags as the other
// programs).
//
// The input is a list of amounts, one byte each. The fee is 2.5 percent of their total, rounded up to a whole unit:
// fee = ceil(total * 25 / 1000). An empty input has a fee of 0. The result is the fee.
//
// How the harness talks to the module:
//   input_buf() -> i32   address of a 256 byte buffer the harness writes the input into
//   parse(len: i32) -> i32   computes the fee of the first len bytes of that buffer
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
    let mut total: u32 = 0;
    for &b in input {
        total += b as u32;
    }
    fee(total) as i32
}

// 2.5 percent of the total, rounded up, in one step: the largest total (255 * 256) times 25 fits in a u32.
fn fee(total: u32) -> u32 {
    (total * 25 + 999) / 1000
}

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}
