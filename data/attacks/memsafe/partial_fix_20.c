// Memory safety corpus: a PARTIAL fix. It refuses names over 20 bytes, not over 16, so names of 17 to 20 bytes still overflow.
// Input: a name length n (1 byte), the name (n bytes), then two bytes a and b.
// parse returns checksum(first 16 name bytes) * a + b, or -1 when the input is too short.
// The bug: n is trusted when the name is copied into a 16 byte buffer, so n above 16 writes past the buffer.
// In WebAssembly that write stays inside linear memory and does not trap: the plain build returns a value as if
// nothing happened. Only an instrumented build (rt.h, build.sh) turns the overflow into a trap.
// STACK_BUF puts the buffer on the stack instead of the heap.
#include "rt.h"

#define NAME_CAP 16

__attribute__((export_name("parse"))) int parse(int len) {
    if (len < 1) return -1;
    int n = INPUT[0];
    if (len < 1 + n + 2) return -1;
#ifdef STACK_BUF
    u8 name[NAME_CAP];
#else
    u8 *name = rt_alloc(NAME_CAP);
#endif
    if (n > 20) return -2;  // partial: 17 to 20 still overflow
    rt_copy(name, INPUT + 1, n);
    int k = n < NAME_CAP ? n : NAME_CAP;
    int s = 0;
    for (int i = 0; i < k; i++) s = s * 31 + name[i];
    int r = s * INPUT[1 + n] + INPUT[2 + n];
#ifndef STACK_BUF
    rt_free(name);
#endif
    return r;
}
