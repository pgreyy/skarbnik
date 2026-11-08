// B1 rule: a user never receives a file they do not own and were not given. The rule replays the transcript: it
// follows who is logged in, which successful create made whom the owner, and which successful share by the owner gave a
// user access. Every read that succeeded (a code of 0 or more) must be by the owner or a user the file was shared with.
#include "../rt_rule.h"

__attribute__((export_name("check"))) int check(int len) {
    u8 owner[16] = {0}, shared[16] = {0}, user = 0;
    struct call c; int pos = 0;
    while (next_call(len, &pos, &c)) {
        if (c.status != 0) continue;
        int f = c.nargs > 0 ? c.args[0] : 255;
        if (c.op == 0 && c.code >= 0 && c.nargs > 0 && c.args[0] >= 1 && c.args[0] <= 7) user = c.args[0];
        else if (c.op == 4 && c.code >= 0) user = 0;
        else if (c.op == 1 && c.code >= 0 && f < 16 && !owner[f]) owner[f] = user;
        else if (c.op == 2 && c.code >= 0 && f < 16 && c.nargs > 1 && c.args[1] < 8 && owner[f] == user && user) shared[f] |= (u8)(1 << c.args[1]);
        else if (c.op == 3 && c.code >= 0) {
            if (!user || f > 15) return 1;
            if (owner[f] != user && !(shared[f] & (1 << user))) return 1;
        }
    }
    return 0;
}
