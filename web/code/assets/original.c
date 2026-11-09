// An asset path resolver for files under one root folder (it serves uploads written on Windows and on Linux). One
// call, op 0: the arguments are a relative path. Both "/" and "\" separate segments. Empty and "." segments are
// dropped, ".." removes the segment before it, and a ".." with nothing left to remove means the path would leave the
// root, so the call returns -1. The output is the clean path, segments joined by "/", with no leading "/" (an empty
// output is the root itself).
#include "rt_call.h"

__attribute__((export_name("call"))) int call(int op, int len) {
    if (op != 0) return -1;
    int out = 0, i = 0;
    while (i <= len) {
        int s = i;
        while (i < len && IN[i] != '/') i++;
        int k = i - s;
        if (k == 0 || (k == 1 && IN[s] == '.')) {
        } else if (k == 2 && IN[s] == '.' && IN[s + 1] == '.') {
            if (out == 0) return -1;
            while (out > 0 && OUT[out - 1] != '/') out--;
            if (out > 0) out--;
        } else {
            if (out > 0) OUT[out++] = '/';
            for (int j = s; j < i; j++) OUT[out++] = IN[j] == '\\' ? '/' : IN[j];
        }
        i++;
    }
    return out;
}
