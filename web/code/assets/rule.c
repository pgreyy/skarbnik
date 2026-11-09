// Rule of the asset path resolver: a clean path stays inside the root. For each call that returned an output: no "\"
// in it, it does not start with "/", and none of its segments is empty, "." or "..". A refused call (a negative code)
// is allowed. An empty output is the root.
#include "rt_rule.h"

static int inside(const struct call *c) {
    const u8 *o = c->out; int n = c->nout, i = 0;
    if (n == 0) return 1;
    if (o[0] == '/') return 0;
    for (int j = 0; j < n; j++) if (o[j] == '\\') return 0;
    while (i <= n) {
        int s = i;
        while (i < n && o[i] != '/') i++;
        int k = i - s;
        if (k == 0) return 0;
        if (k == 1 && o[s] == '.') return 0;
        if (k == 2 && o[s] == '.' && o[s + 1] == '.') return 0;
        i++;
    }
    return 1;
}

__attribute__((export_name("check"))) int check(int len) {
    struct call c; int pos = 0;
    while (next_call(len, &pos, &c)) {
        if (c.status != 0 || c.code < 0) continue;
        if (!inside(&c)) return 1;
    }
    return 0;
}
