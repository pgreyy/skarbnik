// B1 demo: a small file sharing store. Users 1 to 7; files 0 to 15, each at most 16 bytes. Operations:
//   op 0 login(user)            the caller becomes user; 0, or -2 for a user outside 1 to 7
//   op 1 create(file, bytes...) a new file owned by the caller; 0, or -1 not logged in, -2 a bad or taken file number
//   op 2 share(file, user)      the owner lets another user read the file; 0, or -1 not logged in, -3 not the owner
//   op 3 read(file)             the file's bytes, for its owner and for users it was shared with; -1 not logged in,
//                               -2 no such file, -3 not allowed
//   op 4 logout()               0
#include "../rt_call.h"

static u8 owner[16];
static u8 shared[16];
static u8 size[16];
static u8 data[16][16];
static u8 user;

__attribute__((export_name("call"))) int call(int op, int len) {
    int f = len > 0 ? IN[0] : 255;
    if (op == 0) {
        if (len < 1 || IN[0] < 1 || IN[0] > 7) return -2;
        user = IN[0];
        return 0;
    }
    if (op == 4) { user = 0; return 0; }
    if (!user) return -1;
    if (op == 1) {
        if (f > 15 || owner[f]) return -2;
        owner[f] = user;
        size[f] = (u8)(len - 1 > 16 ? 16 : len - 1);
        for (int i = 0; i < size[f]; i++) data[f][i] = IN[1 + i];
        return 0;
    }
    if (op == 2) {
        if (f > 15 || len < 2 || IN[1] < 1 || IN[1] > 7) return -2;
        if (owner[f] != user) return -3;
        shared[f] |= (u8)(1 << IN[1]);
        return 0;
    }
    if (op == 3) {
        if (f > 15 || !owner[f]) return -2;
        for (int i = 0; i < size[f]; i++) OUT[i] = data[f][i];
        return size[f];
    }
    return -2;
}
