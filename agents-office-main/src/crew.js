// Órbita — A CIRCULAÇÃO: como as pessoas se movem nesta empresa (28 out 2026)
//
// Pedido do dono, por palavras dele: «cria movimentos de movimentação para cada chefe do grupo
// quando tiver dúvida ou querendo pedir ajuda, se dirigirá à sala do Cérebro (sala master)»; e
// «quando peço algo através do chat, o chefe deve estar na sala, depois vai à sala dele e explica
// ao grupo e criam, e vão-se ajudando — como 100% de pessoas normais numa empresa de engenharia
// informática real».
//
// A REGRA QUE MANDA NESTE FICHEIRO: nada acontece por relógio. Um chefe só se levanta quando há
// um trabalho REAL na base de dados — uma tarefa que começou (vai buscá-la ao Cérebro) ou um
// agente à espera de decisão (vai pedir ajuda). Sem trabalho, ninguém anda: ficam sentados.
// A caminhada é a representação de um facto; não é o facto.
//
// O percurso tem sempre os mesmos pontos, e é isso que o torna legível:
//     secretária → corredor da sala (o eixo entre as filas) → porta → corredor → Cérebro
// e de volta, pela mesma ordem, para explicar ao grupo no topo da sala.
import * as THREE from 'three';
import { posePerson, poseWork } from './avatar.js';

/** Um passo ao longo do percurso de um agente. Devolve true quando chega ao fim. */
export function walkStep(r, dt) {
  const cur = r.person.position, tgt = r.path[r.pathI];
  if (!tgt) return true;
  const d = new THREE.Vector3().subVectors(tgt, cur); d.y = 0;
  const dist = d.length();
  const step = r.speed * dt;
  if (dist <= step) {
    cur.copy(tgt);
    r.pathI++;
    if (r.pathI >= r.path.length) return true;
  } else {
    d.normalize();
    cur.addScaledVector(d, step);
    r.person.rotation.y = Math.atan2(d.x, d.z);
  }
  return false;
}

/* Durações. São curtas de propósito: ninguém quer ver um chefe a passear 30 segundos. */
const DWELL = { brief: 3000, help: 2400, handoff: 2200 };  // tempo no Cérebro
const TELL = { brief: 3200, help: 2000, handoff: 0 };      // tempo a explicar ao grupo
const SIGNAL_TTL = 25000;                          // um sinal velho já não manda ninguém a andar
const COOLDOWN = 9000;                             // entre duas viagens do mesmo chefe

export function createCrew({ R, AGENTS, DEPTS, LAYOUT, deptRT, hall, deskFront, onEmote, onPhase }) {
  /* Cadência. É um objecto mutável de propósito: o teste de cena encurta-o para provar o ciclo
     inteiro (ir · receber · voltar · explicar · sentar) em menos de dois segundos. */
  const timing = { DWELL: { ...DWELL }, TELL: { ...TELL }, SIGNAL_TTL, COOLDOWN };
  const depts = Object.keys(DEPTS).filter((k) => k !== 'brain');
  const chief = {};
  for (const k of depts) {
    const a = AGENTS.find((x) => x.dept === k && x.lead);
    if (a) chief[k] = a.id;
  }
  const spotOf = {};
  for (const s of (hall && hall.spots) || []) spotOf[s.dept] = s;

  const pending = [];             // sinais à espera de um chefe livre
  const done = new Map();         // `kind:sig` já tratado
  const lastTrip = new Map();     // dept → quando o chefe viajou pela última vez
  const huddles = new Map();      // dept → { until, x, z, chief }
  const stats = { trips: 0, briefs: 0, helps: 0, handoffs: 0, huddles: 0 };
  const log = [];                 // as últimas viagens, para inspecção (CC.office.crew)
  const pushLog = (o) => { log.push(o); if (log.length > 40) log.shift(); };

  /** O sítio do chefe em frente às secretárias, no eixo entre as duas colunas. */
  function frontSpot(dept) {
    const L = LAYOUT[dept];
    return new THREE.Vector3(L.pos[0], 0, L.pos[1] + deskFront(dept) + 1.35);
  }
  function standOf(r) {
    const v = r.stand.clone();
    v.y = 0;
    return v;
  }

  /** O percurso até ao Cérebro: corredor da sala → porta → passadeira → lugar no anel. */
  function routeToBrain(r, dept) {
    const L = LAYOUT[dept];
    const gate = deptRT[dept].gate;
    const bg = deptRT[dept].brainGate;
    const sp = spotOf[dept];
    const pts = [frontSpot(dept)];
    if (gate) pts.push(new THREE.Vector3(gate.x, 0, gate.z));
    if (bg) pts.push(new THREE.Vector3(bg.x, 0, bg.z));
    if (sp) pts.push(new THREE.Vector3(sp.standX, 0, sp.standZ));   // o Cérebro vive em (0,0)
    return pts;
  }
  /** A volta: Cérebro → passadeira → porta → frente das secretárias → lugar dele. */
  function routeHome(r, dept) {
    const L = LAYOUT[dept];
    const gate = deptRT[dept].gate;
    const bg = deptRT[dept].brainGate;
    const pts = [];
    if (bg) pts.push(new THREE.Vector3(bg.x, 0, bg.z));
    if (gate) pts.push(new THREE.Vector3(gate.x, 0, gate.z));
    pts.push(frontSpot(dept));
    return pts;
  }

  function startTrip(r, kind, sig) {
    const dept = r.a.dept;
    const pts = routeToBrain(r, dept);
    if (!pts.length) return false;
    r.trip = {
      kind, sig, dept, phase: 'out', until: 0,
      faceY: (spotOf[dept] && spotOf[dept].faceY) || 0,
      startedAt: performance.now(),
    };
    r.path = pts; r.pathI = 0;
    r.state = 'walking';
    if (r.warn) r.warn.visible = false;   // a caminho do Cérebro não se fica com o aviso no ar
    lastTrip.set(dept, performance.now());
    stats.trips++;
    if (kind === 'brief') stats.briefs++; else if (kind === 'handoff') stats.handoffs++; else stats.helps++;
    pushLog({ at: new Date().toISOString(), kind, dept, agent: r.a.id, sig });
    if (onEmote) onEmote(r, kind === 'brief' ? '📋' : kind === 'handoff' ? '📦' : '❓');
    if (onPhase) onPhase(kind, dept, r.a.id, kind === 'handoff' ? 'a levar o trabalho ao Cérebro' : 'a caminho do Cérebro');
    return true;
  }

  /** O chefe chega ao anel: pára de frente para o orbe e fica o tempo de «receber» / «perguntar». */
  function arriveBrain(r) {
    const T = r.trip, sp = spotOf[T.dept];
    if (sp) {
      r.person.position.x = sp.standX;
      r.person.position.z = sp.standZ;
      T.faceY = sp.faceY;
    }
    r.person.rotation.y = T.faceY;
    r.state = 'atBrain';
    T.phase = 'atBrain';
    T.until = performance.now() + (timing.DWELL[T.kind] ?? 2600);
    if (onEmote) onEmote(r, T.kind === 'brief' ? '🧠' : T.kind === 'handoff' ? '🏁' : '🤝');
    if (onPhase) onPhase(T.kind, T.dept, r.a.id,
      T.kind === 'brief' ? 'no Cérebro a receber o pedido'
        : T.kind === 'handoff' ? 'no Cérebro a entregar o trabalho' : 'no Cérebro a pedir ajuda');
  }

  function startHome(r) {
    const T = r.trip;
    r.path = routeHome(r, T.dept); r.pathI = 0;
    r.state = 'returning';
    T.phase = 'back';
  }

  /** O último troço: do topo da sala até ao lugar dele. Sem isto o chefe «teleportava» para a
      cadeira depois de explicar — um salto que se vê e que estragava a cena toda. */
  function startSeat(r) {
    const T = r.trip;
    r.path = [standOf(r)]; r.pathI = 0;
    r.state = 'returning';
    T.phase = 'seat';
    if (onPhase) onPhase(T.kind, T.dept, r.a.id, 'de volta ao lugar');
  }

  /** De volta à sala: pára no topo, virado ao grupo, e explica. O grupo levanta-se para ouvir. */
  function startTell(r) {
    const T = r.trip;
    // entregar um trabalho não se explica ao grupo: entrega-se e volta-se ao posto
    if (!(timing.TELL[T.kind] > 0)) { startSeat(r); return; }
    const f = frontSpot(T.dept);
    r.person.position.set(f.x, 0, f.z);
    r.person.rotation.y = Math.PI;             // de frente para as secretárias (z local −)
    r.state = 'explaining';
    T.phase = 'tell';
    T.until = performance.now() + (timing.TELL[T.kind] ?? 2400);
    T.tellAt = { x: f.x, z: f.z };
    huddles.set(T.dept, {
      until: T.until, x: f.x, z: f.z, chief: r.a.id,
      startedAt: performance.now(),
    });
    stats.huddles++;
    if (onPhase) onPhase(T.kind, T.dept, r.a.id, T.kind === 'brief' ? 'a explicar ao grupo' : 'a contar o que trouxe');
  }

  function endTrip(r) {
    const T = r.trip;
    r.trip = null;
    r.path = null; r.pathI = 0;
    // volta ao lugar dele e devolve o corpo ao estado que a base de dados manda
    r.person.position.copy(r.seat);
    r.person.rotation.y = r.seatRot;
    r.state = r.liveState === 'live' ? 'working' : r.liveState === 'waiting' ? 'stuck' : r.liveState === 'error' ? 'error' : 'idle';
    if (r.warn) r.warn.visible = r.state === 'stuck' || r.state === 'error';
    if (onPhase) onPhase(T.kind, T.dept, r.a.id, 'de volta ao posto');
  }

  /** Um sinal real: `brief` (trabalho novo para a sala) ou `help` (alguém à espera de decisão). */
  function signal(kind, dept, sig) {
    if (!chief[dept] || !sig) return false;
    const key = kind + ':' + dept + ':' + sig;
    if (done.has(key)) return false;
    done.set(key, performance.now());
    pending.push({ kind, dept, sig, key, at: performance.now() });
    // a memória dos sinais não pode crescer sem fim
    if (done.size > 400) { const first = done.keys().next().value; done.delete(first); }
    return true;
  }

  /** Quem manda: um chefe livre apanha o sinal mais antigo que ainda interesse. */
  function direct(now = performance.now()) {
    // O primeiro sinal que tenha um chefe livre. Um chefe ocupado não bloqueia os outros: é
    // exactamente isto que faz duas salas a caminho do Cérebro ao mesmo tempo.
    for (let i = 0; i < pending.length; i++) {
      const s = pending[i];
      if (now - s.at > timing.SIGNAL_TTL) { pending.splice(i, 1); i--; continue; }
      const r = R[chief[s.dept]];
      if (!r) { pending.splice(i, 1); i--; continue; }
      if (r.trip) continue;
      if (now - (lastTrip.get(s.dept) || 0) < timing.COOLDOWN) continue;
      // um chefe que está a trabalhar levanta-se; um que está à espera de OK também
      startTrip(r, s.kind, s.sig);
      pending.splice(i, 1);
      return true;
    }
    return false;
  }

  /** Avança o corpo de um agente que está numa viagem. Devolve true se tratou dele.
      Nota de relojoaria: os prazos medem-se SEMPRE com `performance.now()` (a mesma origem do
      `requestAnimationFrame` num browser a sério). O `now` que vem do main é o do ciclo de desenho
      e serve só para as poses — misturar os dois relógios fazia o chefe sair do Cérebro no mesmo
      frame em que chegava (visto no harness, onde o rAF é alimentado com `Date.now()`). */
  function tick(r, now, dt) {
    const T = r.trip;
    if (!T) return false;
    const agora = performance.now();
    if (T.phase === 'out' || T.phase === 'back') {
      posePerson(r.person, 'walk', now);
      if (walkStep(r, dt)) {
        if (T.phase === 'out') arriveBrain(r); else startTell(r);
      }
      return true;
    }
    if (T.phase === 'atBrain') {
      posePerson(r.person, 'stand', now);
      // vira-se devagar para o orbe, como quem se senta à mesa
      let d = T.faceY - r.person.rotation.y;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      r.person.rotation.y += d * (1 - Math.exp(-dt * 4));
      if (agora > T.until) startHome(r);
      return true;
    }
    if (T.phase === 'tell') {
      // quem explica está de pé e mexe as mãos; o resto do corpo é o do costume
      poseWork(r.person, 'listen', now + r.bob * 200, dt);
      if (T.tellAt) r.person.position.set(T.tellAt.x, 0, T.tellAt.z);
      r.person.rotation.y = Math.PI;
      if (agora > T.until) startSeat(r);
      return true;
    }
    if (T.phase === 'seat') {
      posePerson(r.person, 'walk', now);
      if (walkStep(r, dt)) endTrip(r);
      return true;
    }
    return true;
  }

  /** O grupo de uma sala a ouvir o chefe, ou null. */
  function huddle(dept, now = performance.now()) {
    const h = huddles.get(dept);
    if (!h) return null;
    if (now > h.until) { huddles.delete(dept); return null; }
    return h;
  }

  function state() {
    return {
      depts, chief, spots: spotOf,
      stats, pending: pending.length,
      huddles: [...huddles.entries()].map(([k, v]) => ({ dept: k, until: v.until, x: v.x, z: v.z })),
      trips: Object.values(R).filter((r) => r.trip).map((r) => ({ agent: r.a.id, dept: r.a.dept, kind: r.trip.kind, phase: r.trip.phase })),
      log: log.slice(-12),
    };
  }

  return { signal, direct, tick, huddle, state, routeToBrain, routeHome, frontSpot, timing };
}
