import re, sys, os, glob, json, subprocess
HERE = os.path.dirname(os.path.abspath(__file__))
D = json.load(open(os.path.join(HERE,'dict.json'), encoding='utf-8'))
EN = set("""the and you your yours to of for with this that these those is are was were be been being will would can could should add adds added send sends sent sending
from into onto about above after again all also always any are because before being below between both but by can did do does doing done down during each few
find first get gets got has have having he her here hers him his how i if in is it its just know last less let like
make makes many may me might more most much must my no nor not now of off on once one only or other our out over own same see she should so some
such take than then there they thing think this those through time too under until up us very want was way we well were what when where which while who
why will with without work works working would yes yet ready task tasks agent agents team teams office brain notes note day days week weeks today tomorrow yesterday
next previous open close save cancel delete remove edit search filter refresh copy download upload new all none more less show hide loading failed error
success warning confirm understood something nothing anything everything someone everyone who what when where why how which this that
approval approved approve reject run running pause resume schedule scheduled repeat model effort usage settings profile
waiting waiting in done pending live overview zoom calendar chat activity status board department departments
email emails client clients report reports invoice invoices lead leads proposal proposals campaign campaigns
write writes written draft drafted read reads reading reply replies answer answers review reviews check checks
call calls meeting meetings quote quotes price prices budget pay paid payment payments bill bills
cost costs revenue cash forecast balance contract contracts vendor vendors supplier suppliers
risk risks plan plans planning project projects delivery deliveries design designs
linkedin instagram stripe notion gmail slack chrome canva meta xero apollo loops beehiiv clarity
""".split())
LOW = {w.lower() for w in EN}

def cand(t):
    if not t or len(t.strip())<3: return False
    if re.search(r'\$\{|[;{}]|\bpx\b|rgba?\(|=>|https?://', t): return False
    words = re.findall(r"[A-Za-z][A-Za-z'’-]*", t)
    if not words: return False
    hits = [w for w in words if w.lower() in LOW]
    return len(hits) >= 1 and len(words) >= 2

def scan(path):
    s = open(path, encoding='utf-8').read()
    out = set()
    if path.endswith('.html'):
        for m in re.finditer(r'>([^<>]+)<', s):
            if cand(m.group(1)): out.add(m.group(1).strip())
        for m in re.finditer(r'(?:placeholder|title|aria-label|alt)="([^"]*)"', s):
            if cand(m.group(1)): out.add(m.group(1).strip())
        return out
    for m in re.finditer(r"""(['"`])((?:[^'"`\\\n]|\\.){2,400}?)\1""", s):
        b = m.group(2)
        if re.search(r'[<>]', b): continue
        if cand(b): out.add(b.strip())
    return out

files = sys.argv[1:]
for f in files:
    cs = sorted(scan(f))
    cs = [c for c in cs if c.lower() not in D]
    if not cs: continue
    print(f'\n=== {f} ({len(cs)}) ===')
    for c in cs: print(c[:220])
