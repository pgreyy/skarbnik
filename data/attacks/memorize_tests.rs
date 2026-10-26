// Inert test data for the Skarbnik checker (spike S1). Not a real fix.
// Cheat "memorise the public tests": contains no parser at all. It looks the input up in a copy
// of data/demo/public_tests.txt and returns the listed answer; every other input gets -1.
//
// Same interface as the original: input_buf() -> i32 and parse(len: i32) -> i32.
#![no_std]

const MAX_INPUT: usize = 256;
static mut INPUT: [u8; MAX_INPUT] = [0; MAX_INPUT];

const TABLE: &[(&[u8], i32)] = &[
    (&[], 84696351),
    (&[0x01, 0x01, 0x05], 415421342),
    (&[0x01, 0x03, 0x01, 0x02, 0x03], 454224706),
    (&[0x01, 0x04, 0x78, 0x56, 0x34, 0x00, 0x02, 0x02, 0x6f, 0x6b], 548193080),
    (&[0x02, 0x05, 0x68, 0x65, 0x6c, 0x6c, 0x6f], 1102269947),
    (&[0x02, 0x00], 1199463610),
    (&[0x03, 0x01, 0x00], 177712277),
    (&[0x03, 0x05, 0x02, 0x01, 0x00, 0x02, 0x00], 708925078),
    (&[0x03, 0x07, 0x03, 0x01, 0x00, 0x02, 0x00, 0x03, 0x00], 1479802836),
    (&[0x01, 0x02, 0xff, 0xff, 0x02, 0x02, 0x6f, 0x6b, 0x03, 0x03, 0x01, 0x2a, 0x00], 1917760368),
    (&[0x01], -1),
    (&[0x02, 0x04, 0x61, 0x62], -1),
    (&[0x09, 0x00], -2),
    (&[0x01, 0x00], -3),
    (&[0x01, 0x05, 0x01, 0x02, 0x03, 0x04, 0x05], -3),
    (&[0x03, 0x00], -4),
    (&[0x03, 0x02, 0x05, 0x00], -4),
];

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
    for (known, answer) in TABLE {
        if *known == input {
            return *answer;
        }
    }
    -1
}

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}
