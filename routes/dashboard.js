// routes/dashboard.js
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../middleware/auth.js';

// Cliente admin local al router (evita depender de ../lib)
const supabaseAdmin = (() => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
})();

const router = express.Router();
router.use(requireAuth);

// /api/dashboard/summary -> plan (garantías, shop, servicio)
router.get('/summary', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .rpc('dashboard_basic_summary', { p_user_id: req.user.id });
    if (error) throw error;
    const b = (data && data[0]) || {};
    res.json({
      guarantees_enabled: !!b.guarantees_enabled,
      shop_enabled: !!b.shop_enabled,
      service: b.service_preference || null
    });
  } catch (e) {
    console.error('SUMMARY ERROR', e);
    res.status(500).json({ error: 'SUMMARY_ERROR' });
  }
});

// /api/dashboard/guarantees -> detalles como “Commissions”
router.get('/guarantees', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .rpc('dashboard_guarantee_details', { p_user_id: req.user.id });
    if (error) throw error;
    const r = (data && data[0]) || {};
    res.json({
      products_with: Number(r.products_with_guarantee || 0),
      products_without: Number(r.products_without_guarantee || 0),
      on_hold: {
        count: Number(r.orders_on_hold_count || 0),
        gross_usd: Number(r.orders_on_hold_gross_usd || 0),
        net_usd: Number(r.orders_on_hold_net_usd || 0),
        next_release_at: r.next_release_at || null
      },
      released: {
        count: Number(r.orders_released_count || 0),
        net_usd: Number(r.orders_released_net_usd || 0)
      }
    });
  } catch (e) {
    console.error('GUARANTEES ERROR', e);
    res.status(500).json({ error: 'GUARANTEES_ERROR' });
  }
});

export default router;
