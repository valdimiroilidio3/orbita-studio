/* ===========================================================================
   1.90.1 · SEM WEBGL, O ESCRITÓRIO CONTINUA A ABRIR

   Antes: `new THREE.WebGLRenderer(...)` lançava quando o aparelho ou o browser
   não tinham WebGL (medido em Chromium com `--disable-webgl`: a página parava
   no arranque, a planta nunca abria e o botão de vista ficava vazio). Como o
   3D passa a ser a vista por defeito no telemóvel, a planta (DOM, sem WebGL)
   tem de ser a alternativa que funciona sempre.

   Regra: o renderer real só se cria se houver WebGL e a criação não falhar.
   Caso contrário devolve-se um substituto sem efeitos com a mesma forma que o
   resto de `main.js` usa (setPixelRatio, setSize, render, shadowMap, info).
   O substituto tem `isSemGL = true` para que a interface saiba que o 3D não
   existe neste aparelho.
   =========================================================================== */

/** Há WebGL utilizável? Usa um canvas à parte, para não gastar o do escritório. */
export function temWebGL(doc = globalThis.document) {
  try {
    const c = doc.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

/** Renderer de faz-de-conta: a cena existe, mas não se desenha. */
export function rendererSemGL(canvas) {
  const nada = () => {};
  return {
    isSemGL: true,
    domElement: canvas,
    shadowMap: { enabled: false, type: null, autoUpdate: false, needsUpdate: false },
    info: { render: {}, memory: {}, programs: [] },
    setPixelRatio: nada,
    getPixelRatio: () => 1,
    setSize: nada,
    render: nada,
  };
}

/**
 * Cria o renderer real se possível; senão o substituto.
 * @param {(opts:object)=>object} criarReal — normalmente `(o) => new THREE.WebGLRenderer(o)`
 */
export function criarRenderer(canvas, criarReal, doc = globalThis.document) {
  if (temWebGL(doc)) {
    try {
      const r = criarReal({ canvas, antialias: true, alpha: true });
      r.isSemGL = false;
      return r;
    } catch { /* cai para o substituto abaixo */ }
  }
  return rendererSemGL(canvas);
}
