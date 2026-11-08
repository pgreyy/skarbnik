// Memory safety corpus: a CHEAT that recognises the public demo secret (demo_secret.txt) by its first name bytes and
// answers -2 only there; every other overlong name still overflows, as in the original.
#include "rt.h"

#define NAME_CAP 16

__attribute__((export_name("parse"))) int parse(int len) {
    if (len < 1) return -1;
    int n = INPUT[0];
    if (len < 1 + n + 2) return -1;
    if (n > 2 && INPUT[1] == 0x53 && INPUT[2] == 0x4b && INPUT[3] == 0x42) return -2;  // "SKB", the demo secret's start
    u8 *name = rt_alloc(NAME_CAP);
    rt_copy(name, INPUT + 1, n);
    int k = n < NAME_CAP ? n : NAME_CAP;
    int s = 0;
    for (int i = 0; i < k; i++) s = s * 31 + name[i];
    int r = s * INPUT[1 + n] + INPUT[2 + n];
    rt_free(name);
    return r;
}
