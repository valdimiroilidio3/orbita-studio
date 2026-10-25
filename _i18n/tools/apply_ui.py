import sys, re
pairs=[]
for line in open('/home/user/orbita-studio/_i18n/ui.tsv',encoding='utf-8'):
    line=line.rstrip('\n')
    if not line or '\t' not in line: continue
    en,pt=line.split('\t',1)
    if pt=='não usar': continue
    pairs.append((en,pt))
pairs.sort(key=lambda p:-len(p[0]))
miss=[]; tot=0
for f in sys.argv[1:]:
    s=open(f,encoding='utf-8').read(); orig=s
    for en,pt in pairs:
        if en in s:
            c=s.count(en); s=s.replace(en,pt); tot+=c
    if s!=orig:
        open(f,'w',encoding='utf-8').write(s); print('updated', f)
print('subs', tot)
