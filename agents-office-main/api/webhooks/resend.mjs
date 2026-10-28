/* POST /api/webhooks/resend — um email de resposta (assinado pelo Svix).
   Ver api/_entrada.mjs. Sem RESEND_WEBHOOK_SECRET não se aceita nada. */
import { config, tratarWebhook } from './_comum.mjs';
export { config };
export default async function handler(req, res) {
  return tratarWebhook(req, res, '/webhooks/resend');
}
