import re, sys, glob, json, os

FILES = sorted(glob.glob('src/*.js')) + ['serve.mjs'] + sorted(glob.glob('*.mjs')) + ['src/shell.html']
SKIP = {'src/braingraph.js','src/mcplogos.js','check.mjs','build.mjs','graph-build.mjs'}

def strip_style_script(s):
    s = re.sub(r'(?is)<style[^>]*>.*?</style>', '', s)
    s = re.sub(r'(?is)<script[^>]*>.*?</script>', '', s)
    return s

def is_prose(t):
    t = t.strip()
    if not t or not re.search(r'[A-Za-z]', t): return False
    if len(t) < 2: return False
    if re.search(r'[;{}]|https?://|\bpx\b|rgba?\(|var\(--|→\s*\$|=>', t): return False
    words = re.findall(r'[A-Za-z][A-Za-z\'-]+', t)
    if len(words) >= 2: return True
    if t.isupper() and len(t) >= 3: return True
    return False

cands = {}
for f in FILES:
    if f in SKIP: continue
    s = open(f).read()
    body = strip_style_script(s) if f.endswith('.html') else s
    # markup text nodes
    for m in re.finditer(r'>([^<>]{2,200})<', body):
        t = m.group(1)
        if is_prose(t): cands.setdefault(t.strip(), set()).add(f)
    # attributes
    for m in re.finditer(r'(?:placeholder|title|aria-label|alt)="([^"]{2,200})"', body):
        t = m.group(1)
        if is_prose(t): cands.setdefault(t.strip(), set()).add(f)
    # quoted literals (not containing newlines)
    for m in re.finditer(r"""(['"])((?:[^'"\\\n]|\\.){2,240}?)\1""", body):
        t = m.group(2)
        if is_prose(t) and not re.search(r'[<>]', t):
            cands.setdefault(t.strip(), set()).add(f)

rows = sorted(cands.items(), key=lambda kv: -(len(kv[0])))
out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/cands.txt'
with open(out, 'w') as fh:
    for t, fs in rows:
        fh.write(f"{len(t)}\t{t}\t{','.join(sorted(fs))}\n")
print(len(rows), sum(len(t) for t,_ in rows))
