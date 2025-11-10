// routes/eventLinks.js  (ESM)
import express from 'express';
import { supabase } from '../lib/supabase.js';
import auth from '../middlewares/auth.js';

const router = express.Router();

/**
 * GET /api/event-links
 * Devuelve los eventos del usuario con su short link embebido (vista v_event_links)
 */
router.get('/', auth, async (req, res) => {
  const { data, error } = await supabase
    .from('v_event_links')
    .select('*')
    .eq('user_id', req.user.id)
    .order('starts_at', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  // Aseguramos short.short_url si viniera nulo
  const out = (data || []).map(row => {
    if (row?.short && typeof row.short === 'object') {
      const { domain, path } = row.short;
      if (!row.short.short_url && domain && path) {
        row.short.short_url = `${domain}/${path}`;
      }
    }
    return row;
  });

  res.json(out);
});

export default router;
