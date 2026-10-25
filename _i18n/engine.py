# -*- coding: utf-8 -*-
import re, json, sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
RAW = json.load(open(os.path.join(HERE, 'dict.json'), encoding='utf-8'))
D = {k.strip().lower(): v for k, v in RAW.items() if k.strip()}

def _fix(src, out):
    s = src.strip()
    if len(s) > 2 and s.isupper():
        return out.upper()
    return out

def tr(t):
    s = t.strip()
    if not s:
        return t
    v = D.get(s.lower())
    if v is None:
        return t
    v = _fix(s, v)
    lead = t[:len(t) - len(t.lstrip())]
    trail = t[len(t.rstrip()):]
    return lead + v + trail

NO_TR = re.compile(r'\$\{|\bpx\b|rgba?\(|var\(--|=>|https?://|;|\{|\}|<|>')
CSSY = re.compile(r'^[.#]?[a-z0-9][a-z0-9\-]*([ .#][a-z0-9\-]+)+$')

def html(s):
    s = re.sub(r'>([^<>]+)<', lambda m: '>' + tr(m.group(1)) + '<', s)
    s = re.sub(r'(placeholder|title|aria-label|alt)="([^"]*)"',
               lambda m: f'{m.group(1)}="{tr(m.group(2))}"', s)
    return s

def display_safe(b):
    # only translate strings that are unambiguously display copy, never identifiers/enum values
    if not b: return False
    if b.lower() not in D: return False
    if ' ' in b: return True
    if len(b) >= 2 and b.isupper(): return True           # ALLCAPS labels (ADD, TASKS)
    if re.search(r'[a-z][A-Z]', b): return True           # camelCase-free mixed words
    return False

def js(s):
    def lit(m):
        q, body = m.group(1), m.group(2)
        b = body.strip()
        if not b or NO_TR.search(b) or CSSY.match(b):
            return m.group(0)
        if not display_safe(b):
            return m.group(0)
        return q + tr(body) + q
    return re.sub(r"""(['"`])((?:[^'"`\\\n]|\\.){1,400}?)\1""", lit, s)

def process(path):
    s = open(path, encoding='utf-8').read()
    if path.endswith('.html'):
        parts, last = [], 0
        for m in re.finditer(r'(?is)<style[^>]*>.*?</style>|<script[^>]*>.*?</script>', s):
            parts.append(html(s[last:m.start()])); parts.append(m.group(0)); last = m.end()
        parts.append(html(s[last:]))
        new = ''.join(parts)
    else:
        new = js(html(s))
    if new != s:
        open(path, 'w', encoding='utf-8').write(new)
        return True
    return False

if __name__ == '__main__':
    for p in sys.argv[1:]:
        print(('updated ' if process(p) else 'same    ') + p)
