import fs from 'fs';
const STOP = /\b(the|and|you|your|with|from|what|that|this|have|will|not|are|is|for|of|to|in|on|by|at|it|we|they|be|should|would|could|can|all|each|every|our|their|there|when|while|after|before|into|about|out|up|just|only|more|most|than|then|so|if|but|or|an|without|down|over|off|again|also|here|never|always|still|get|got|say|says|make|makes|need|needs|want|wants|know|keep|keeps|take|takes|give|send|sent|run|runs)\b/i;
const files = process.argv.slice(2);
const counts = new Map();
function bodies(src) {
  const out = [];
  const re = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
  let m;
  while ((m = re.exec(src))) out.push(m[0].slice(1,-1));
  return out;
}
for (const f of files) {
  const src = fs.readFileSync(f,'utf8');
  for (let b of bodies(src)) {
    b = b.replace(/\$\{[^{}]*(\{[^{}]*\}[^{}]*)*\}/g, ' § ');   // mask interpolations
    b = b.replace(/<[^>]*>/g, ' ');                              // mask markup
    b = b.replace(/\\n/g, ' ');
    const runs = b.match(/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9 ,.;:!?%$€£@#_()\-–—’…°/+]*/g) || [];
    for (let r of runs) {
      const t = r.trim().replace(/\s+/g,' ');
      if (t.length < 4) continue;
      if (!STOP.test(t)) continue;
      if (/^(https?|www)/i.test(t)) continue;
      counts.set(t, (counts.get(t)||0)+1);
    }
  }
}
const arr = [...counts.entries()].sort((a,b)=> b[1]-a[1] || a[0].localeCompare(b[0]));
for (const [k,v] of arr) console.log(v + '\t' + k);
console.error('UNIQUE', arr.length, 'CHARS', arr.reduce((n,[k])=>n+k.length+4,0));
