import fs from 'fs';
const STOP = /\b(the|and|you|your|with|from|what|that|this|have|will|not|are|is|for|of|to|in|on|by|at|it|we|they|be|should|would|could|can|all|each|every|our|their|there|when|while|after|before|into|about|out|up|just|only|more|most|than|then|so|if|but|or|an|a)\b/i;
const files = process.argv.slice(2);
const seen = new Map();
for (const f of files) {
  const s = fs.readFileSync(f,'utf8').split('\n');
  s.forEach((line, i) => {
    const lits = line.match(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g) || [];
    for (const l of lits) {
      const body = l.slice(1,-1);
      if (body.length < 3 || !/[A-Za-zÀ-ÿ]/.test(body)) continue;
      const words = body.split(/\s+/).filter(w=>/[A-Za-zÀ-ÿ]/.test(w));
      const stop = (body.match(new RegExp(STOP.source,'gi'))||[]).length;
      const caps = /^[A-Z0-9 ·/&’'—–%+№-]{4,}$/.test(body.trim());
      if ((stop >= 1 && words.length >= 2) || caps) {
        const key = body.replace(/\s+/g,' ').trim();
        if (!seen.has(key)) seen.set(key, `${f}:${i+1}`);
      }
    }
  });
}
for (const [k,v] of seen) console.log(k + '  \t' + v);
console.log('TOTAL', seen.size);
