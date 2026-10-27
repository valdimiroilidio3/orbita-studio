#!/usr/bin/env python3
"""Replace a whole string literal, found by a unique anchor inside it, with new text.
Keeps the original quote style and escapes correctly."""
import sys, re, json

def esc_body(body, quote):
    if quote == '`':
        return body.replace('\\', '\\\\').replace('`', '\\`').replace('${', '\\${')
    out = body.replace('\\', '\\\\')
    out = out.replace('\n', '\\n').replace('\t', '\\t')
    if quote == "'":
        out = out.replace("'", "\\'")
    else:
        out = out.replace('"', '\\"')
    return out

LIT = re.compile(r"'(?:[^'\\\n]|\\.)*'|\"(?:[^\"\\\n]|\\.)*\"|`(?:[^`\\]|\\.)*`", re.S)

def apply(path, table):
    src = open(path, encoding='utf-8').read()
    hits = 0
    for anchor, new in table.items():
        found = None
        for m in LIT.finditer(src):
            if anchor in m.group(0):
                found = m
        if not found:
            print('  MISS  %s' % anchor[:70]); continue
        q = found.group(0)[0]
        lit = q + esc_body(new, q) + q
        src = src[:found.start()] + lit + src[found.end():]
        hits += 1
    open(path, 'w', encoding='utf-8').write(src)
    print('%s: %d/%d' % (path, hits, len(table)))

if __name__ == '__main__':
    mod = sys.argv[1]
    ns = {}
    exec(open(mod, encoding='utf-8').read(), ns)
    apply(sys.argv[2], ns['T'])
