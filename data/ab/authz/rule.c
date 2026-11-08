// B2 rule: only an admin can make someone an admin. The rule replays the transcript from the start state (user 1 is
// the only admin), follows who is logged in and every successful role change, and says violation when a role change to
// admin succeeded for a caller who was not an admin at that moment.
#include "../rt_rule.h"

__attribute__((export_name("check"))) int check(int len) {
    u8 role[8], user = 0;
    for (int i = 0; i < 8; i++) role[i] = 1;
    role[1] = 2;
    struct call c; int pos = 0;
    while (next_call(len, &pos, &c)) {
        if (c.status != 0 || c.code < 0) continue;
        if (c.op == 0 && c.nargs > 0 && c.args[0] >= 1 && c.args[0] <= 7) user = c.args[0];
        else if (c.op == 3) user = 0;
        else if (c.op == 1 && c.nargs > 1 && c.args[0] >= 1 && c.args[0] <= 7) {
            if (c.args[1] == 2 && (!user || role[user] != 2)) return 1;
            role[c.args[0]] = c.args[1];
        }
    }
    return 0;
}
