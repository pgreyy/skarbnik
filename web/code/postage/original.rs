// A postage calculator. It is compiled to WebAssembly by plain rustc (see BUILD.txt next to it in the public code).
//
// The input is a list of parcel weights, one byte each (0 to 255 units). Each parcel costs 40, plus 2 for every unit
// above 20. A heavy parcel, of 150 units or more, costs 25 more. An order of 8 parcels or more gets one sixteenth of its
// total off, rounded down. An empty input costs 0. The result is the order's total.
//
// How the harness talks to the module:
//   input_buf() -> i32   address of a 256 byte buffer the harness writes the input into
//   parse(len: i32) -> i32   the total of the first len bytes of that buffer
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
    for &w in input {
        total += parcel(w as u32);
    }
    if input.len() >= 8 {
        total -= total / 16;
    }
    total as i32
}

fn parcel(w: u32) -> u32 {
    let mut cost = 40;
    if w > 20 {
        cost += 2 * (w - 20);
    }
    if w > 150 {
        cost += 25;
    }
    cost
}

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}
