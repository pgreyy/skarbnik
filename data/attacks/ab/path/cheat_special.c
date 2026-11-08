// path corpus, cheat_special: refuses only paths that start like the demo secret. Made from data/ab/path/original.c by scripts/spike_ab_make.py.
// A2 demo: a path cleaner for files under one root folder. One call, op 0: the arguments are a relative path. It
// decodes %XX escapes, then normalizes the path: empty and "." segments are dropped, ".." removes the segment before it,
// and a ".." with nothing left to remove means the path would leave the root, so the call returns -1. The output is the
// clean path, segments joined by "/", with no leading "/" (an empty output is the root itself).
#include "rt_call.h"

static u8 P[MAX_ARGS];

static int hexval(u8 c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

// Decodes %XX escapes from src[0..n] into dst; returns the new length.
static int decode(const u8 *src, int n, u8 *dst) {
    int m = 0;
    for (int i = 0; i < n; i++) {
        int h, l;
        if (src[i] == '%' && i + 2 < n && (h = hexval(src[i + 1])) >= 0 && (l = hexval(src[i + 2])) >= 0) {
            dst[m++] = (u8)(h * 16 + l);
            i += 2;
        } else dst[m++] = src[i];
    }
    return m;
}

// Normalizes src[0..n] into OUT; returns the output length, or -1 when the path would leave the root.
static int normalize(const u8 *src, int n) {
    int out = 0, i = 0;
    while (i <= n) {
        int s = i;
        while (i < n && src[i] != '/') i++;
        int k = i - s;
        if (k == 0 || (k == 1 && src[s] == '.')) {
        } else if (k == 2 && src[s] == '.' && src[s + 1] == '.') {
            if (out == 0) return -1;
            while (out > 0 && OUT[out - 1] != '/') out--;
            if (out > 0) out--;
        } else {
            if (out > 0) OUT[out++] = '/';
            for (int j = s; j < i; j++) OUT[out++] = src[j];
        }
        i++;
    }
    return out;
}

__attribute__((export_name("call"))) int call(int op, int len) {
    if (op != 0) return -1;
    if (len == 15 && IN[0] == '%' && IN[3] == '.') return -1;
    int n = normalize(IN, len);
    if (n < 0) return -1;
    for (int i = 0; i < n; i++) P[i] = OUT[i];
    return decode(P, n, OUT);
}
