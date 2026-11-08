// Runtime for the memory safety demo (data/memsafe): the input buffer the checker writes into, a tiny bump allocator,
// and the copy routine. Built with no C library and no imports. Compile time switches pick how an out of bounds
// write is caught; each one ends in __builtin_trap(), the WebAssembly `unreachable` instruction, which the checker
// already treats as a crash, so no import is needed:
//   (none)         plain build: an overflow corrupts memory silently and nothing traps
//   RT_GUARD       every allocation gets 8 guard bytes after it; rt_free traps if one was overwritten
//   RT_FORTIFY     rt_copy traps when the length is larger than the destination object the compiler can see
//   -fstack-protector-all  the compiler's stack canary; __stack_chk_fail below traps
//   -fsanitize=bounds with -fsanitize-trap=bounds: the compiler's array index checks (no code needed here)
typedef unsigned char u8;
typedef unsigned long usize;

#define MAX_INPUT 256
static u8 INPUT[MAX_INPUT];

__attribute__((export_name("input_buf"))) int input_buf(void) { return (int)(usize)INPUT; }

// The heap: a fixed arena and a bump pointer. A fresh instance per input starts it empty again. rt_alloc is kept out
// of line: inlined, the compiler loses its alloc_size and RT_FORTIFY cannot see a heap block's size.
#define HEAP_BYTES 1024
static u8 HEAP[HEAP_BYTES];
static usize heap_top;

#ifdef RT_GUARD
#define GUARD_BYTES 8
#define GUARD_BYTE 0xA5
// Layout of one block: [size, 4 bytes][user bytes][8 guard bytes].
__attribute__((alloc_size(1), noinline)) static u8 *rt_alloc(usize n) {
    usize need = 4 + n + GUARD_BYTES;
    if (heap_top + need > HEAP_BYTES) __builtin_trap();
    u8 *b = HEAP + heap_top;
    heap_top += (need + 3) & ~(usize)3;
    *(unsigned *)b = (unsigned)n;
    for (usize i = 0; i < GUARD_BYTES; i++) b[4 + n + i] = GUARD_BYTE;
    return b + 4;
}
static void rt_free(u8 *p) {
    usize n = *(unsigned *)(p - 4);
    for (usize i = 0; i < GUARD_BYTES; i++)
        if (p[n + i] != GUARD_BYTE) __builtin_trap();  // a write ran past the block
}
#else
__attribute__((alloc_size(1), noinline)) static u8 *rt_alloc(usize n) {
    if (heap_top + n > HEAP_BYTES) __builtin_trap();
    u8 *b = HEAP + heap_top;
    heap_top += (n + 3) & ~(usize)3;
    return b;
}
static void rt_free(u8 *p) { (void)p; }
#endif

static inline __attribute__((always_inline)) void rt_copy(u8 *dst, const u8 *src, usize n) {
#ifdef RT_FORTIFY
    if (n > __builtin_dynamic_object_size(dst, 0)) __builtin_trap();
#endif
    __builtin_memcpy(dst, src, n);
}

// For -fstack-protector-all: the canary value and what happens when it was overwritten.
usize __stack_chk_guard = 0x5a3c96e1;
void __stack_chk_fail(void) { __builtin_trap(); }
