#!/usr/bin/env python3
# coding: utf-8

import sys
import subprocess

stdout = subprocess.check_output('git branch'.split())
out = stdout.decode()
branches = [b for b in out.splitlines()]


args = sys.argv
if (len(args) >= 2):
    print()
    b = branches[int(args[1])]
    subprocess.run(['git', 'co', b.strip('* ')])
    subprocess.run(['git', 'br'])
else:
    for i, b in enumerate(branches):
        print(i, b)


