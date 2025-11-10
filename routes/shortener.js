// routes/shortener.js (ESM)
import express from 'express';
import { supabase } from '../lib/supabase.js';
import auth from '../middlewares/auth.js';

const router = express.Router();

const ALLOWED = (process.env.SHORTENER_ALLOWED_DOMAINS || '')
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

const isAllowedDomain = d =>
  !ALLOWED.length || ALLOWED.includes(String(d || '').toLowerCase());

const SLUG_RE = /^[a-z0-9-]{1,80}$/;

/* ---------- GET /api/shortener?type=event ---------- */
router.get('/', auth, async (req, res) => {
  const type = (req.query.type || '').toLowerCase();
  let q = supabase.from('short_links').select('*').eq('user_id', req.user.id);
  if (type === 'event') q = q.eq('ref_table', 'events');

  const { data, error } = await q.order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

/* ---------- POST /api/shortener (crear) ----------
  body: {
    ref_table: 'events',
    ref_id: <uuid>,
    domain: 'viplinks.org/e' | 'vl.ink',
    path: 'mi-slug',
    target_url: 'https://...',
    utm?: { source, medium, campaign, term, content }
  }
*/
router.post('/', auth, async (req, res) => {
  const { ref_table = 'events', ref_id, domain, path, target_url, utm } = req.body || {};
  if (!ref_id || !domain || !path || !target_url) {
    return res.status(400).json({ error: 'Campos requeridos: ref_id, domain, path, target_url' });
  }
  if (!isAllowedDomain(domain)) return res.status(400).json({ error: 'Dominio no permitido' });
  if (!SLUG_RE.test(path)) return res.status(400).json({ error: 'Slug inválido' });

  // Ownership del recurso
  if (ref_table === 'events') {
    const { data: ev, error: e1 } = await supabase
      .from('events')
      .select('id,user_id')
      .eq('id', ref_id)
      .single();

    if (e1 || !ev) return res.status(404).json({ error: 'Evento no encontrado' });
    if (ev.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  } else {
    return res.status(400).json({ error: 'ref_table no soportada' });
  }

  // ¿Ya existe domain+path?
  const { data: dup } = await supabase
    .from('short_links')
    .select('id,user_id')
    .eq('domain', domain)
    .eq('path', path)
    .maybeSingle();

  if (dup) {
    if (dup.user_id !== req.user.id) return res.status(409).json({ error: 'Slug ya en uso' });
    const { data, error } = await supabase
      .from('short_links')
      .update({ target_url, utm: utm || null })
      .eq('id', dup.id)
      .select('*')
      .single();
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ ...data, short_url: `${data.domain}/${data.path}` });
  }

  // Crear
  const insert = {
    user_id: req.user.id,
    ref_table,
    ref_id,
    domain,
    path,
    target_url,
    utm: utm || null
  };

  const { data, error } = await supabase
    .from('short_links')
    .insert(insert)
    .select('*')
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json({ ...data, short_url: `${data.domain}/${data.path}` });
});

/* ---------- PATCH /api/shortener/:id (editar) ----------
  body: { domain?, path?, utm? }
*/
router.patch('/:id', auth, async (req, res) => {
  const { id } = req.params;
  const { domain, path, utm } = req.body || {};

  const { data: s, error: e1 } = await supabase
    .from('short_links')
    .select('*')
    .eq('id', id)
    .single();

  if (e1 || !s) return res.status(404).json({ error: 'Not found' });
  if (s.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

  const upd = {};
  if (domain !== undefined) {
    if (!isAllowedDomain(domain)) return res.status(400).json({ error: 'Dominio no permitido' });
    upd.domain = domain;
  }
  if (path !== undefined) {
    if (!SLUG_RE.test(path)) return res.status(400).json({ error: 'Slug inválido' });
    upd.path = path;
  }
  if (utm !== undefined) upd.utm = utm;

  // Conflicto domain+path si cambian
  if (upd.domain || upd.path) {
    const ndomain = upd.domain || s.domain;
    const npath = upd.path || s.path;
    const { data: dup } = await supabase
      .from('short_links')
      .select('id,user_id')
      .eq('domain', ndomain)
      .eq('path', npath)
      .maybeSingle();

    if (dup && dup.id !== s.id) return res.status(409).json({ error: 'Slug ya en uso' });
  }

  const { data, error } = await supabase
    .from('short_links')
    .update(upd)
    .eq('id', id)
    .select('*')
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json({ ...data, short_url: `${data.domain}/${data.path}` });
});

/* ---------- DELETE /api/shortener/:id ---------- */
router.delete('/:id', auth, async (req, res) => {
  const { id } = req.params;

  const { data: s, error: e1 } = await supabase
    .from('short_links')
    .select('id,user_id')
    .eq('id', id)
    .single();

  if (e1 || !s) return res.status(404).json({ error: 'Not found' });
  if (s.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

  const { error } = await supabase.from('short_links').delete().eq('id', id);
  if (error) return res.status(400).json({ error: error.message });

  res.json({ ok: true });
});

/* ---------- (Opcional) Fallback /api/shortener/update ----------
   Compatible con frontends antiguos que POSTean update
*/
router.post('/update', auth, async (req, res) => {
  const { id, domain, path, utm } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id requerido' });
  req.params.id = id;
  return router.handle({ ...req, method: 'PATCH', url: `/${id}` }, res);
});

export default router;
