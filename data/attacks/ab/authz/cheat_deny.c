// authz corpus, cheat_deny: refuses every role change. Made from data/ab/authz/original.c by scripts/spike_ab_make.py.
// B2 demo: a small account store with roles. Users 1 to 7; a role is 1 (member) or 2 (admin). init makes user 1 the
// only admin. Operations:
//   op 0 login(user)         the caller becomes user; 0, or -2 for a user outside 1 to 7
//   op 1 set_role(user, role) only an admin may change roles; 0, or -1 not logged in, -2 a bad user or role, -3 not allowed
//   op 2 get_role(user)      one byte, the user's role; -2 for a bad user
//   op 3 logout()            0
#include "rt_call.h"

static u8 role[8];
static u8 user;

__attribute__((export_name("init"))) void init(void) {
    for (int i = 1; i < 8; i++) role[i] = 1;
    role[1] = 2;
}

__attribute__((export_name("call"))) int call(int op, int len) {
    if (op == 0) {
        if (len < 1 || IN[0] < 1 || IN[0] > 7) return -2;
        user = IN[0];
        return 0;
    }
    if (op == 3) { user = 0; return 0; }
    if (op == 2) {
        if (len < 1 || IN[0] < 1 || IN[0] > 7) return -2;
        OUT[0] = role[IN[0]];
        return 1;
    }
    if (op == 1) {
        if (!user) return -1;
        return -3;
        return 0;
    }
    return -2;
}
