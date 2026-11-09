// Rule of the project registry: only a project's owner can hand it to someone else. The rule replays the transcript
// from the start state (no projects, nobody logged in), follows who is logged in, every project created and every
// transfer that went through, and says violation when a transfer succeeded for a caller who did not own the project at
// that moment.
#include "rt_rule.h"

__attribute__((export_name("check"))) int check(int len) {
    u8 owner[16], user = 0;
    for (int i = 0; i < 16; i++) owner[i] = 0;
    struct call c; int pos = 0;
    while (next_call(len, &pos, &c)) {
        if (c.status != 0 || c.code < 0) continue;
        int p = c.nargs > 0 ? c.args[0] : 255;
        if (c.op == 0 && c.nargs > 0 && c.args[0] >= 1 && c.args[0] <= 7) user = c.args[0];
        else if (c.op == 4) user = 0;
        else if (c.op == 1 && p < 16 && user) owner[p] = user;
        else if (c.op == 2 && p < 16 && c.nargs > 1) {
            if (!user || owner[p] != user) return 1;
            owner[p] = c.args[1];
        }
    }
    return 0;
}
