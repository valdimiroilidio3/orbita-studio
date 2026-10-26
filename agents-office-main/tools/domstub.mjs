// Um `document` mínimo para os builders que desenham texturas em canvas (o chão, o ecrã, o teclado).
// Só existe para os scripts de inspecção em node; o browser tem o verdadeiro.
const ctx = () => ({
  canvas: null,
  fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '10px sans-serif', textAlign: 'left', textBaseline: 'alphabetic',
  globalAlpha: 1, shadowBlur: 0, shadowColor: '#000', lineCap: 'butt', lineJoin: 'miter', filter: 'none',
  save() {}, restore() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, rect() {},
  fill() {}, stroke() {}, clip() {}, fillRect() {}, strokeRect() {}, clearRect() {}, translate() {}, rotate() {}, scale() {},
  fillText() {}, strokeText() {}, drawImage() {}, setLineDash() {}, createLinearGradient: () => ({ addColorStop() {} }),
  createRadialGradient: () => ({ addColorStop() {} }), measureText: (t) => ({ width: String(t).length * 7 }), getImageData: () => ({ data: [] }),
  quadraticCurveTo() {}, bezierCurveTo() {}, ellipse() {}, arcTo() {}, transform() {}, resetTransform() {}, createPattern: () => null,
  putImageData() {}, createImageData: () => ({ data: [] }), isPointInPath: () => false,
  putImageData() {}, roundRect() {},
});
function makeCanvas() {
  const c = { width: 1, height: 1, style: {}, getContext: () => ctx() };
  return c;
}
globalThis.document = globalThis.document || { createElement: () => makeCanvas(), createElementNS: () => makeCanvas() };
globalThis.window = globalThis.window || { devicePixelRatio: 1 };
