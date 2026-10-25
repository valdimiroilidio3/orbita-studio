import { JSDOM } from 'jsdom';
import fs from 'fs';
const html = fs.readFileSync('dist/command-centre-v2.html','utf8');
const errs=[];
const dom = new JSDOM(html, { runScripts:'dangerously', pretendToBeVisual:true,
  beforeParse(w){ w.HTMLCanvasElement.prototype.getContext = ()=>null; w.requestAnimationFrame=()=>0; }});
dom.window.addEventListener('error', e=>errs.push(String(e.error||e.message)));
await new Promise(r=>setTimeout(r,2500));
const d = dom.window.document; d.querySelectorAll('script,style').forEach(e=>e.remove());
const txt = d.body.textContent.replace(/\s+/g,' ');
fs.writeFileSync('/tmp/dom.txt', txt);
// also attribute-based labels
const attrs=[];
for (const el of d.querySelectorAll('[title],[aria-label],[placeholder]')) {
  for (const a of ['title','aria-label','placeholder']) { const v=el.getAttribute(a); if(v) attrs.push(v); }
}
fs.writeFileSync('/tmp/dom_attrs.txt', attrs.join('\n'));
console.log('chars', txt.length, 'errs', errs.slice(0,3));
