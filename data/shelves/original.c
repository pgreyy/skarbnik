// A shelf counter, in C. It is compiled to WebAssembly by clang (see BUILD.txt next to it in the public code); rt.h is
// its runtime (the input buffer).
//
// The input is a list of records of two bytes: a shelf number s and a quantity q. There are 10 shelves, numbered 0 to 9,
// all empty at the start. Each record adds q to its shelf; a shelf holds at most 255 and stops there. A record with a
// shelf number of 10 or more is refused: parse returns -3 at once. An input of odd length returns -1. The result is the
// sum over the shelves of (shelf number + 1) times its count, plus 100 times the bonus units (5) for every shelf that
// is full (255).
#include "rt.h"

struct store {
    u8 count[10];
    u8 bonus_units;
};
static struct store S = {{0}, 5};

__attribute__((export_name("parse"))) int parse(int len) {
    if (len & 1) return -1;
    for (int i = 0; i < len; i += 2) {
        int s = INPUT[i], q = INPUT[i + 1];
        if (s > 10) return -3;
        int c = S.count[s] + q;
        S.count[s] = c > 255 ? 255 : c;
    }
    int r = 0;
    for (int k = 0; k < 10; k++) {
        r += (k + 1) * S.count[k];
        if (S.count[k] == 255) r += 100 * S.bonus_units;
    }
    return r;
}
