/* ===========================================================================
   O ambiente de um pedido (1.18.0, 30 out 2026).

   A Vercel injecta um token OIDC por pedido no cabeçalho `x-vercel-oidc-token`.
   O AI Gateway aceita esse token como Bearer, por isso a IA funciona sem chave
   nenhuma guardada. O token vive **só** nesta chamada: não é escrito em lado
   nenhum, não é devolvido ao browser e não aparece no `/ia/estado`.
   =========================================================================== */
export function envDoPedido(req) {
  const env = { ...process.env };
  if (env.AI_GATEWAY_API_KEY) return env;            // uma chave explícita ganha sempre
  const oidc = (req && req.headers && req.headers['x-vercel-oidc-token']) || env.VERCEL_OIDC_TOKEN;
  if (oidc) env.AI_GATEWAY_API_KEY = String(oidc);
  return env;
}
