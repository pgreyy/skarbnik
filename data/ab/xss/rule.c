// A1 rule: every output is safe for a quoted HTML attribute and means the same text. For each call that returned an
// output: no raw < > " or ' in it, and decoding its entities (&amp; &lt; &gt; &quot; &#39; &apos; and &#NN;) gives back
// exactly the input. A refused call (a negative code) is allowed.
#include "../rt_rule.h"

static int starts(const u8 *p, int n, const char *s) {
    int i = 0;
    for (; s[i]; i++) if (i >= n || p[i] != (u8)s[i]) return 0;
    return i;
}

static int same(const struct call *c) {
    int i = 0, j = 0;
    while (i < c->nout) {
        const u8 *p = c->out + i; int n = c->nout - i, k; u8 v;
        if (*p == '<' || *p == '>' || *p == '"' || *p == '\'') return 0;
        if (*p != '&') { v = *p; k = 1; }
        else if ((k = starts(p, n, "&amp;"))) v = '&';
        else if ((k = starts(p, n, "&lt;"))) v = '<';
        else if ((k = starts(p, n, "&gt;"))) v = '>';
        else if ((k = starts(p, n, "&quot;"))) v = '"';
        else if ((k = starts(p, n, "&#39;")) || (k = starts(p, n, "&apos;"))) v = '\'';
        else if (n >= 4 && p[1] == '#') {
            int x = 0; k = 2;
            while (k < n && p[k] >= '0' && p[k] <= '9' && k < 6) x = x * 10 + (p[k++] - '0');
            if (k == 2 || k >= n || p[k] != ';' || x > 255) return 0;
            k++; v = (u8)x;
        } else return 0;
        if (j >= c->nargs || c->args[j] != v) return 0;
        i += k; j++;
    }
    return j == c->nargs;
}

__attribute__((export_name("check"))) int check(int len) {
    struct call c; int pos = 0;
    while (next_call(len, &pos, &c)) {
        if (c.status != 0 || c.code < 0) continue;
        if (!same(&c)) return 1;
    }
    return 0;
}
