// Runtime for the rule checker's programs: the argument buffer the harness writes a call's arguments
// into, and the output buffer a call leaves its output bytes in. No C library and no imports.
// The interface: call(op, len) runs operation op on the first len argument bytes and returns the output's length (the
// bytes are at output_buf), or a negative code with no output. State in static memory persists across the calls of
// one run; the harness starts a fresh instance for every run.
typedef unsigned char u8;
typedef unsigned long usize;

#define MAX_ARGS 256
#define MAX_OUT 1024
static u8 IN[MAX_ARGS];
static u8 OUT[MAX_OUT];

__attribute__((export_name("input_buf"))) int input_buf(void) { return (int)(usize)IN; }
__attribute__((export_name("output_buf"))) int output_buf(void) { return (int)(usize)OUT; }
