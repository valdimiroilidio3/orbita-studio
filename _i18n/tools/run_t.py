import sys
sys.path.insert(0,'.')
import setlit, importlib
mod, target = sys.argv[1], sys.argv[2]
ns={}; exec(open(mod,encoding='utf-8').read(), ns)
setlit.apply(target, ns['T'])
s=open(target,encoding='utf-8').read(); n=0
for a,b in ns.get('P',[]):
    if a in s: n+=s.count(a); s=s.replace(a,b)
    else: print('  miss P:', a[:60])
open(target,'w',encoding='utf-8').write(s); print('phrases', n)
