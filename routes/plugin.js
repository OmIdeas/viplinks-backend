// routes/plugin.js
import express from 'express';
import crypto from 'crypto';
import { supabaseAdmin } from '../supabase.js';

const router = express.Router();

/** Helper: buscar server por server_key (sanitiza y valida prefijo) */
async function getServerByKey(rawKey) {
  const serverKey = String(rawKey || '').trim();
  if (!serverKey.startsWith('vl_key_')) return null;

  const { data: server, error } = await supabaseAdmin
    .from('servers')
    .select('id, user_id, server_name, server_ip, rcon_port, server_key') // SIN hmac_secret
    .eq('server_key', serverKey)
    .limit(1)
    .maybeSingle();

  if (error || !server) return null;
  return server;
}

/** HMAC opcional: si no hay secret, no se exige */
function verifyHmac(req, secret) {
  if (!secret) return true;
  const ts = req.header('x-timestamp');
  const sig = req.header('x-signature');
  if (!ts || !sig) return false;

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(ts, 10)) > 300) return false; // ±5 min

  const body = JSON.stringify(req.body || {});
  const base = `${req.method}\n${req.originalUrl}\n${ts}\n${body}`;
  const expected = crypto.createHmac('sha256', secret).update(base).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

/** GET /api/plugin/health/:serverKey */
router.get('/health/:serverKey', async (req, res) => {
  const server = await getServerByKey(decodeURIComponent(req.params.serverKey));
  if (!server) return res.status(404).json({ ok: false, error: 'server_not_found' });
  return res.json({ ok: true, server_id: server.id, server_name: server.server_name });
});

/** GET /api/plugin/pending-deliveries/:serverKey */
router.get('/pending-deliveries/:serverKey', async (req, res) => {
  const server = await getServerByKey(decodeURIComponent(req.params.serverKey));
  if (!server) return res.status(404).json({ success: false, error: 'server_not_found' });

  // Como no seleccionamos hmac_secret, por defecto no se valida HMAC.
  // Si luego agregás la columna y querés exigirla:
  // const valid = verifyHmac(req, server.hmac_secret);
  // if (!valid) return res.status(401).json({ success: false, error: 'invalid_signature' });

  const { data: rows, error } = await supabaseAdmin
    .from('pending_deliveries')
    .select('id, sale_id, steam_id, username, product_name, commands, created_at, attempts, last_attempt, error_message, status')
    .eq('server_key', server.server_key)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(50);

  if (error) return res.status(500).json({ success: false, error: error.message });

  const deliveries = (rows || []).map(r => ({
    sale_id: r.sale_id,
    steam_id: r.steam_id,
    username: r.username || null,
    product_name: r.product_name || null,
    commands: r.commands || [],
    created_at: r.created_at,
    delivery_attempts: r.attempts || 0,
    last_attempt: r.last_attempt || null,
    error_message: r.error_message || null
  }));

  // Enriquecer username/product_name si faltan (opcional)
  const needHydrate = deliveries.filter(d => !d.username || !d.product_name);
  if (needHydrate.length) {
    const saleIds = [...new Set(needHydrate.map(d => d.sale_id).filter(Boolean))];
    if (saleIds.length) {
      const { data: sales } = await supabaseAdmin
        .from('sales')
        .select('id, buyer_username, product_name, product_id')
        .in('id', saleIds);

      const productIds = [...new Set((sales || []).map(s => s.product_id).filter(Boolean))];
      let products = [];
      if (productIds.length) {
        const resp = await supabaseAdmin.from('products').select('id, name').in('id', productIds);
        products = resp.data || [];
      }
      for (const d of deliveries) {
        const s = (sales || []).find(x => x.id === d.sale_id);
        if (s) {
          d.username = d.username || s.buyer_username || null;
          d.product_name = d.product_name || s.product_name || (products.find(p => p.id === s.product_id)?.name) || null;
        }
      }
    }
  }

  return res.json({
    success: true,
    count: deliveries.length,
    deliveries,
    server_name: server.server_name
  });
});

/** POST /api/plugin/mark-delivered */
router.post('/mark-delivered', async (req, res) => {
  const { server_key, sale_id, success, error_message } = req.body || {};
  if (!server_key || !sale_id) return res.status(400).json({ ok: false, error: 'missing_fields' });

  const server = await getServerByKey(server_key);
  if (!server) return res.status(404).json({ ok: false, error: 'server_not_found' });

  // Si luego querés exigir HMAC, volvés a seleccionar hmac_secret y descomentás:
  // if (!verifyHmac(req, server.hmac_secret)) return res.status(401).json({ ok: false, error: 'invalid_signature' });

  const { data: pending } = await supabaseAdmin
    .from('pending_deliveries')
    .select('id')
    .eq('server_key', server.server_key)
    .eq('sale_id', sale_id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!pending) return res.status(404).json({ ok: false, error: 'delivery_not_found' });

  const now = new Date().toISOString();

  if (success) {
    await supabaseAdmin.from('pending_deliveries')
      .update({ status: 'completed', last_attempt: now })
      .eq('id', pending.id);

    await supabaseAdmin.from('sales')
      .update({ delivery_status: 'completed', kit_delivered: true, delivered_at: now })
      .eq('id', sale_id);

    return res.json({ ok: true });
  } else {
    await supabaseAdmin.from('pending_deliveries')
      .update({ last_attempt: now, error_message: error_message || 'plugin_reported_error' })
      .eq('id', pending.id);
    return res.json({ ok: true, noted: true });
  }
});

export default router;
