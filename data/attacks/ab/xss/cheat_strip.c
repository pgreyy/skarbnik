// xss corpus, cheat_strip: drops quotes instead of escaping them. Made from data/ab/xss/original.c by scripts/spike_ab_make.py.
// A1 demo: an HTML attribute escaper. One call, op 0: the arguments are a text; the output is the same text made safe
// for an HTML attribute value quoted with single or double quotes: & < > " and ' become &amp; &lt; &gt; &quot; and
// &#39;. Every other byte is copied as it is. The output is at most 6 times the input.
#include "rt_call.h"

static int put(int n, const char *s) {
    while (*s) OUT[n++] = (u8)*s++;
    return n;
}

__attribute__((export_name("call"))) int call(int op, int len) {
    if (op != 0) return -1;
    int n = 0;
    for (int i = 0; i < len; i++) {
        u8 c = IN[i];
        if (c == '&') n = put(n, "&amp;");
        else if (c == '<') n = put(n, "&lt;");
        else if (c == '>') n = put(n, "&gt;");
        else if (c == '"') n = put(n, "&quot;");
        else if (c == '\'') {}
        else OUT[n++] = c;
    }
    return n;
}
