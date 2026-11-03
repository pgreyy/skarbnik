// A small paint grid of 32 rows of 32 cells, one byte per cell. It is compiled to WebAssembly with plain rustc (see
// BUILD.txt, the same flags as the other programs).
//
// The rows are kept as a ring, so the grid can scroll: after scrolling up by k rows, row 0 is the row that was row k.
// A column number may run past 31: the cell then continues on the next row (column 32 of row 3 is column 0 of row 4).
// The grid is kept at a fixed place near the end of the module's memory (BUILD.txt sets 128 KiB): 1 KiB of cells, then
// 1 KiB of spare bytes. Each run starts on fresh memory, so they start cleared.
//
// The input is a list of operations. The low two bits of the first byte say which one; t is that byte shifted right by 2.
//   0  x c   plot: set the cell at column x, row c % 32 to the value c / 32 (three bytes)
//   1  x c   get: fold the cell at column x, row c % 32 into the result (three bytes)
//   2        scroll: scroll the grid up by 1 + t % 31 rows (one byte)
//   3        row: fold the sum of the 32 cells of row t % 32 into the result (one byte)
// The result is a fingerprint of every fold, the number of operations and the scroll position, or -1 when the last
// operation is cut short.
//
// How the harness talks to the module:
//   input_buf() -> i32   address of a 256 byte buffer the harness writes the input into
//   parse(len: i32) -> i32   runs the operations in the first len bytes of that buffer
#![no_std]

const MAX_INPUT: usize = 256;
const COLS: usize = 32;
const ROWS: usize = 32;
const CELLS: usize = COLS * ROWS;
const GRID_AT: usize = 0x1_f800; // 1 KiB of cells, then 1 KiB of spare bytes, up to the end of memory
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

struct Grid {
    top: usize, // where row 0 starts, a multiple of COLS below CELLS
}

impl Grid {
    // the place of the cell at column x, row y
    fn cell(&self, x: usize, y: usize) -> usize {
        GRID_AT + self.top + y * COLS + x
    }

    fn set(&self, x: usize, y: usize, v: u8) {
        unsafe { core::ptr::write_volatile(self.cell(x, y) as *mut u8, v) }
    }

    fn at(&self, x: usize, y: usize) -> u8 {
        unsafe { core::ptr::read_volatile(self.cell(x, y) as *const u8) }
    }

    fn scroll(&mut self, k: usize) {
        self.top = (self.top + k * COLS) % CELLS;
    }

    fn row_sum(&self, y: usize) -> u32 {
        let mut sum: u32 = 0;
        for x in 0..COLS {
            sum += self.at(x, y) as u32;
        }
        sum
    }
}

fn mix(f: u32, x: u32) -> u32 {
    (f ^ x).wrapping_mul(16_777_619)
}

fn run(input: &[u8]) -> i32 {
    let mut g = Grid { top: 0 };
    let mut f: u32 = 0x811c_9dc5;
    let mut ops: u32 = 0;
    let mut at = 0usize;
    while at < input.len() {
        let op = byte(input, at);
        let t = (op >> 2) as usize;
        match op & 3 {
            0 | 1 => {
                if at + 3 > input.len() {
                    return -1;
                }
                let (x, c) = (byte(input, at + 1) as usize, byte(input, at + 2));
                let y = c as usize % ROWS;
                if op & 3 == 0 {
                    g.set(x, y, c / 32);
                } else {
                    f = mix(f, g.at(x, y) as u32);
                }
                at += 3;
            }
            2 => {
                g.scroll(1 + t % (ROWS - 1));
                at += 1;
            }
            _ => {
                f = mix(f, g.row_sum(t % ROWS));
                at += 1;
            }
        }
        ops += 1;
    }
    f = mix(f, ops);
    (mix(f, g.top as u32) & 0x7fff_ffff) as i32
}

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}
