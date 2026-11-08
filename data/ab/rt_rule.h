// Runtime for the rule modules of the demo programs (data/ab/*/rule.c): the buffer the harness writes the transcript
// into, and readers for it. The transcript holds, for each call: the op (1 byte), the argument length (u16 little
// endian), the arguments, the status (0 returned, 1 trapped, 2 out of fuel), the code (i32 little endian), the output
// length (u16 little endian) and the output. check(len) returns 0 for ok, anything else for a violation.
typedef unsigned char u8;
typedef unsigned long usize;

#define RULE_BUF 16384
static u8 T[RULE_BUF];
__attribute__((export_name("rule_buf"))) int rule_buf(void) { return (int)(usize)T; }

struct call { u8 op; int nargs; const u8 *args; u8 status; int code; int nout; const u8 *out; };

// Reads the call at *pos and moves *pos past it; returns 0 at the end or on a broken transcript.
static int next_call(int len, int *pos, struct call *c) {
    int p = *pos;
    if (p + 3 > len) return 0;
    c->op = T[p];
    c->nargs = T[p + 1] | (T[p + 2] << 8);
    p += 3;
    if (p + c->nargs + 7 > len) return 0;
    c->args = T + p;
    p += c->nargs;
    c->status = T[p];
    c->code = (int)((unsigned)T[p + 1] | ((unsigned)T[p + 2] << 8) | ((unsigned)T[p + 3] << 16) | ((unsigned)T[p + 4] << 24));
    c->nout = T[p + 5] | (T[p + 6] << 8);
    p += 7;
    if (p + c->nout > len) return 0;
    c->out = T + p;
    *pos = p + c->nout;
    return 1;
}
