// routes/dashboard.js
import express from 'express';
import { supabaseAdmin } from '../supabase.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);

// /api/dashboard/summary -> flags de plan básicos (placeholder con datos reales cuando existan)
router.get('/summary', async (req, res) => {
  try {
    const uid = req.user.id;

    // Si tenés una tabla de settings, podés leerla acá.
    // De momento, devolvemos OFF/Disabled salvo que después lo alimentes.
    res.json({
      guarantees_enabled: false,
      shop_enabled: false,
      service: null
    });
  } catch (e) {
    console.error('SUMMARY ERROR', e);
    res.status(500).json({ error: 'SUMMARY_ERROR', detail: e.message });
  }
});

// /api/dashboard/guarantees -> calcula usando products y sales (sin RPC)
router.get('/guarantees', async (req, res) => {
  try {
    const uid = req.user.id;

    const [{ data: products, error: pErr }, { data: sales, error: sErr }] = await Promise.all([
      supabaseAdmin
        .from('products')
        .select('id,type,guarantee,has_guarantee,seller_id')
        .eq('seller_id', uid),
      supabaseAdmin
        .from('sales')
        .select('amount,seller_amount,status,created_at')
        .eq('seller_id', uid)
    ]);

    if (pErr) throw pErr;
    if (sErr) throw sErr;

    // “Generales” = no gaming (ajustá si en tu esquema es type='general')
    const generales = (products || []).filter(p => (p.type || '') === 'general');

    // Intentamos detectar si el producto tiene garantía con dos posibles columnas
    const withGuarantee = generales.filter(p => {
      const g = (p.guarantee ?? p.has_guarantee ?? false);
      return g === true || g === 'true' || g === 1;
    }).length;
    const withoutGuarantee = Math.max(generales.length - withGuarantee, 0);

    const pending = (sales || []).filter(s => s.status === 'pending');
    const completed = (sales || []).filter(s => s.status === 'completed');

    const sum = (arr, f) => arr.reduce((a, x) => a + Number(f(x) || 0), 0);

    const onHold = {
      count: pending.length,
      gross_usd: sum(pending, s => s.amount),
      net_usd:   sum(pending, s => s.seller_amount),
      next_release_at: null // si luego tenés cronogramas, lo completás
    };

    const released = {
      count: completed.length,
      net_usd: sum(completed, s => s.seller_amount)
    };

    res.json({
      products_with: withGuarantee,
      products_without: withoutGuarantee,
      on_hold: onHold,
      released
    });
  } catch (e) {
    console.error('GUARANTEES ERROR', e);
    res.status(500).json({ error: 'GUARANTEES_ERROR', detail: e.message });
  }
});

export default router;
