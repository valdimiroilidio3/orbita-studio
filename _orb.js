
  /* ---------- o Cérebro: um orbe de notas, em 3D ----------
     Segunda passagem (25 out 2026). O grafo é um objecto, não um desenho: os nós são esferas
     dentro de uma lente — hubs ao centro, notas na superfície —, as arestas são curvas que
     passam pelo interior do orbe, cada hub leva um anel na cor da pasta e um halo difuso.
     O orbe roda devagar: é a rotação que dá a profundidade que um desenho plano não tem. */
  const CENTRE = new THREE.Vector3(0, 4.05, 0);
  const RAD = 3.35;                      // raio do orbe
  const LENS = 0.88;                     // achatamento em Z
  let darkOrb = false;

  const orb = new THREE.Group();
  orb.position.copy(CENTRE);
  orb.rotation.x = -0.16;                // inclinação fixa: o topo mostra o interior
  orb.userData.dept = 'brain';
  brainGroup.add(orb);
  const spin = new THREE.Group();        // o que roda com o tempo
  orb.add(spin);

  let pos = new Map();                   // índice → Vector3 local ao orbe
  function layout3() {
    pos = new Map();
    const N = Math.max(1, nodes.length), GA = Math.PI * (3 - Math.sqrt(5));
    nodes.forEach((n, k) => {
      const y = 1 - (k / Math.max(1, N - 1)) * 2;                // −1 … 1
      const rr = Math.sqrt(Math.max(0, 1 - y * y));
      const th = GA * k;
      const dir = new THREE.Vector3(Math.cos(th) * rr, y, Math.sin(th) * rr);
      const deg = Math.min(1, (n.d || 1) / 8);
      const rad = RAD * (0.30 + 0.70 * (1 - deg));               // hubs ao centro, folhas à superfície
      const wob = 0.94 + (Math.sin(k * 12.9898) * 0.5 + 0.5) * 0.11;
      const v = dir.multiplyScalar(rad * wob);
      v.z *= LENS;
      pos.set(n.i, v);
    });
  }
  layout3();
  const onFloor = n => pos.has(n.i);
  const W = n => {                       // posição no mundo (o orbe roda, por isso o mundo muda)
    const v = pos.get(n.i);
    if (!v) return CENTRE.clone();
    orb.updateMatrixWorld(true);
    return orb.localToWorld(v.clone());
  };

  // texturas suaves: um disco radial branco, tingido pelo material de cada sprite
  function radialTex(stops) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 1, 64, 64, 62);
    for (const [at, col] of stops) g.addColorStop(at, col);
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  const haloTex = radialTex([[0, 'rgba(255,255,255,.95)'], [.30, 'rgba(255,255,255,.42)'], [1, 'rgba(255,255,255,0)']]);
  const coreTex = radialTex([[0, 'rgba(255,255,255,1)'], [.55, 'rgba(255,255,255,.92)'], [.78, 'rgba(255,255,255,.25)'], [1, 'rgba(255,255,255,0)']]);

  // a lente: uma casca muito ténue — o que separa o objecto do fundo sem o fechar
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(RAD * 0.99, 48, 32),
    new THREE.MeshBasicMaterial({ color: '#A9BBA8', transparent: true, opacity: 0.045, side: THREE.BackSide, depthWrite: false })
  );
  shell.userData.dept = 'brain'; shell.renderOrder = 1;
  orb.add(shell);

  function clearGroup(g) {
    for (const o of [...g.children]) {
      g.remove(o);
      if (o.geometry) o.geometry.dispose();
      if (o.material) { if (o.material.map && o.material.map !== haloTex && o.material.map !== coreTex) o.material.map.dispose(); o.material.dispose(); }
    }
  }

  function buildOrb() {
    clearGroup(spin);
    const inkCol = new THREE.Color(darkOrb ? '#ECEADF' : '#1B1A18');
    const edgeCol = new THREE.Color(darkOrb ? '#CBD3C8' : '#6F776E');

    // ── arestas: curvas que passam pelo interior do orbe, em duas espessuras
    const strong = [], weak = [];
    for (const [a, b] of links) {
      const pa = pos.get(a), pb = pos.get(b);
      if (!pa || !pb) continue;
      const mid = pa.clone().add(pb).multiplyScalar(0.5).multiplyScalar(0.74); // puxa para o centro
      const curve = new THREE.QuadraticBezierCurve3(pa, mid, pb);
      const pts = curve.getPoints(14);
      const target = (nodes[a].d >= 4 || nodes[b].d >= 4) ? strong : weak;
      for (let i = 0; i < pts.length - 1; i++) target.push(pts[i], pts[i + 1]);
    }
    for (const [pts, op, order] of [[strong, darkOrb ? 0.34 : 0.30, 2], [weak, darkOrb ? 0.16 : 0.13, 1]]) {
      if (!pts.length) continue;
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineBasicMaterial({ color: edgeCol, transparent: true, opacity: op, depthWrite: false });
      const ls = new THREE.LineSegments(geo, mat);
      ls.renderOrder = order; ls.userData.dept = 'brain';
      spin.add(ls);
    }

    // ── nós: halo difuso + núcleo + anel na cor da pasta para os hubs
    const sorted = nodes.filter(onFloor).sort((x, y) => x.d - y.d);
    for (const n of sorted) {
      const p = pos.get(n.i);
      const deg = Math.min(1, (n.d || 1) / 8);
      const col = new THREE.Color(n.fresh ? '#1E9070' : (GROUP_COL[n.g] || '#B0ADA3'));

      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: haloTex, color: col, transparent: true,
        opacity: (n.d >= 4 ? 0.50 : 0.26) * (darkOrb ? 1.15 : 1),
        depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      const hs = 1.05 + deg * 1.15;
      halo.scale.set(hs, hs, 1); halo.position.copy(p); halo.renderOrder = 5;
      halo.userData.dept = 'brain'; spin.add(halo);

      const core = new THREE.Sprite(new THREE.SpriteMaterial({
        map: coreTex, color: n.fresh ? new THREE.Color('#1E9070') : (n.d >= 4 ? col : inkCol),
        transparent: true, opacity: n.d >= 4 ? 0.95 : 0.72, depthWrite: false,
      }));
      const cs = 0.30 + deg * 0.34;
      core.scale.set(cs, cs, 1); core.position.copy(p); core.renderOrder = 6;
      core.userData.dept = 'brain'; spin.add(core);

      if (n.d >= 3) { // anel 3D: cada um numa inclinação própria, para ler como órbita
        const ringGeo = new THREE.TorusGeometry(0.30 + deg * 0.26, 0.013, 8, 48);
        const ringMat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: n.d >= 4 ? 0.75 : 0.42, depthWrite: false });
        const torus = new THREE.Mesh(ringGeo, ringMat);
        torus.position.copy(p);
        torus.rotation.set(1.1 + n.i * 0.7, n.i * 0.9, 0.5 + n.i * 0.35);
        torus.renderOrder = 4; torus.userData.dept = 'brain';
        spin.add(torus);
      }
    }
  }
  function etch() { buildOrb(); }
  etch();
