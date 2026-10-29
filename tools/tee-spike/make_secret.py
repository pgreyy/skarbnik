#!/usr/bin/env python3
"""Makes a fresh private secret input for the demo program (data/demo/original.rs) and writes it, as hex, to a new
file of mode 600. The input is a few random valid records followed by a list record whose length is exactly twice its
item count, which makes the original read one byte past its payload and trap. Nothing about the content is printed.
Usage: make_secret.py <output path>   (the file must not exist yet)"""
import os, secrets, sys

def record():
    kind = secrets.choice((1, 2))
    if kind == 1:
        n = 1 + secrets.randbelow(4); return bytes([1, n]) + secrets.token_bytes(n)
    n = secrets.randbelow(12); return bytes([2, n]) + secrets.token_bytes(n)

def main(path):
    body = b''.join(record() for _ in range(1 + secrets.randbelow(5)))
    n = 1 + secrets.randbelow(6)
    crash = bytes([3, 2 * n, n]) + secrets.token_bytes(2 * n - 1)  # length 2n with n two byte items: reads one past
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    os.write(fd, (body + crash).hex().encode() + b'\n'); os.close(fd)
    print(f'wrote a fresh secret input ({len(body + crash)} bytes) to {path}, mode 600')

if __name__ == '__main__':
    main(sys.argv[1])
