/* GET /api/webhooks/whatsapp  — a verificação da Meta (hub.challenge)
   POST /api/webhooks/whatsapp — as respostas dos clientes e os estados (lido, entregue)
   Ver api/_entrada.mjs. Sem WHATSAPP_APP_SECRET não se aceita nada. */
import { config, tratarWebhook } from './_comum.mjs';
export { config };
export default async function handler(req, res) {
  return tratarWebhook(req, res, '/webhooks/whatsapp');
}
