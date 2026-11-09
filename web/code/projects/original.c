// A small project registry. Users 1 to 7; projects 0 to 15, each with a name of at most 16 bytes. Operations:
//   op 0 login(user)               the caller becomes user; 0, or -2 for a user outside 1 to 7
//   op 1 create(project, name...)  a new project owned by the caller; 0, or -1 not logged in, -2 a bad or taken number
//   op 2 transfer(project, user)   the owner hands the project to another user; 0, or -1 not logged in, -2 a bad
//                                  project or user, -3 not the owner
//   op 3 owner_of(project)         one byte, the owner's number; -2 no such project
//   op 4 logout()                  0
//   op 5 rename(project, name...)  the owner gives the project a new name; 0, or -1 not logged in, -2 no such project,
//                                  -3 not the owner
//   op 6 name_of(project)          the project's name; -2 no such project
#include "rt_call.h"

static u8 owner[16];
static u8 size[16];
static u8 name[16][16];
static u8 user;

static void set_name(int p, int len) {
    size[p] = (u8)(len - 1 > 16 ? 16 : len - 1);
    for (int i = 0; i < size[p]; i++) name[p][i] = IN[1 + i];
}

__attribute__((export_name("call"))) int call(int op, int len) {
    int p = len > 0 ? IN[0] : 255;
    if (op == 0) {
        if (len < 1 || IN[0] < 1 || IN[0] > 7) return -2;
        user = IN[0];
        return 0;
    }
    if (op == 4) { user = 0; return 0; }
    if (op == 3) {
        if (p > 15 || !owner[p]) return -2;
        OUT[0] = owner[p];
        return 1;
    }
    if (op == 6) {
        if (p > 15 || !owner[p]) return -2;
        for (int i = 0; i < size[p]; i++) OUT[i] = name[p][i];
        return size[p];
    }
    if (!user) return -1;
    if (op == 1) {
        if (p > 15 || owner[p]) return -2;
        owner[p] = user;
        set_name(p, len);
        return 0;
    }
    if (op == 2) {
        if (p > 15 || !owner[p] || len < 2 || IN[1] < 1 || IN[1] > 7) return -2;
        owner[p] = IN[1];
        return 0;
    }
    if (op == 5) {
        if (p > 15 || !owner[p]) return -2;
        if (owner[p] != user) return -3;
        set_name(p, len);
        return 0;
    }
    return -2;
}
