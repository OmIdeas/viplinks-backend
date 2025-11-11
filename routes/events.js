// routes/events.js  (ESM)
import express from 'express';
import { supabaseAdmin as supabase } from '../supabase.js';
import auth from '../middlewares/auth.js';

const router = express.Router();

/* ---------------- Helpers ---------------- */
const toNum = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function normalizeContact(body) {
  // acepta plano o anidado
  if (body.contact && typeof body.contact === 'object') return body.contact;
  return {
    website: body.contact_website ?? body.website ?? null,
    phone: body.contact_phone ?? body.phone ?? null,
    whatsapp_number: body.contact_whatsapp ?? body.whatsapp ?? null,
    whatsapp_text: body.contact_whatsapp_text ?? body.whatsapp_text ?? null,
  };
}

function normalizeSocial(body) {
  if (body.social && typeof body.social === 'object') return body.social;
  return {
    instagram: body.social_instagram ?? body.instagram ?? null,
    tiktok: body.social_tiktok ?? body.tiktok ?? null,
    facebook: body.social_facebook ?? body.facebook ?? null,
    other: body.social_other ?? body.other ?? null,
  };
}

function normalizeInsertPayload(body, userId) {
  return {
    user_id: userId,
    name: body.name,
    description: body.description ?? null,
    cover_url: body.cover_url ?? null,

    starts_at: body.starts_at ?? null,
    ends_at: body.ends_at ?? null,

    bg_type: body.bg_type ?? 'color',       // 'color' | 'image'
    bg_value: body.bg_value ?? null,        // hex o url
    text_color: body.text_color ?? '#111827',

    is_online: body.is_online ?? true,
    address: body.address ?? null,
    lat: toNum(body.lat),
    lng: toNum(body.lng),
    map_zoom: toNum(body.map_zoom) ?? 14,

    show_qr: body.show_qr ?? true,
    use_custom_qr: body.use_custom_qr ?? false,
    custom_qr_url: body.custom_qr_url ?? null,

    contact: normalizeContact(body),
    social: normalizeSocial(body),
  };
}

function normalizeUpdatePayload(body) {
  const upd = { ...body };

  // Normalizar tipos numéricos si vinieron como string
  if ('lat' in upd) upd.lat = toNum(upd.lat);
  if ('lng' in upd) upd.lng = toNum(upd.lng);
  if ('map_zoom' in upd) upd.map_zoom = toNum(upd.map_zoom);

  // Contacto/redes si vienen planos
  if (!upd.contact) upd.contact = normalizeContact(upd);
  if (!upd.social) upd.social = normalizeSocial(upd);

  // Evitar que intenten cambiar user_id
  delete upd.user_id;

  return upd;
}

/* ---------------- Rutas ---------------- */

// GET /api/events?mine=1  -> lista SOLO del usuario autenticado
router.get('/', auth, async (req, res) => {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('user_id', req.user.id)
    .order('starts_at', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// POST /api/events  -> crea un evento
router.post('/', auth, async (req, res) => {
  try {
    const payload = normalizeInsertPayload(req.body || {}, req.user.id);

    if (!payload.name) {
      return res.status(400).json({ error: 'name es requerido' });
    }

    const { data, error } = await supabase
      .from('events')
      .insert(payload)
      .select('*')
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Bad request' });
  }
});

// PATCH /api/events/:id  -> edita campos del evento (solo dueño)
router.patch('/:id', auth, async (req, res) => {
  const { id } = req.params;

  const { data: ev, error: e1 } = await supabase
    .from('events')
    .select('id,user_id')
    .eq('id', id)
    .single();

  if (e1 || !ev) return res.status(404).json({ error: 'Not found' });
  if (ev.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

  const upd = normalizeUpdatePayload(req.body || {});

  const { data, error } = await supabase
    .from('events')
    .update(upd)
    .eq('id', id)
    .select('*')
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// DELETE /api/events/:id  -> borra el evento y sus short_links
router.delete('/:id', auth, async (req, res) => {
  const { id } = req.params;

  const { data: ev, error: e1 } = await supabase
    .from('events')
    .select('id,user_id')
    .eq('id', id)
    .single();

  if (e1 || !ev) return res.status(404).json({ error: 'Not found' });
  if (ev.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

  // Borrar shorts vinculados del mismo user
  await supabase
    .from('short_links')
    .delete()
    .eq('ref_table', 'events')
    .eq('ref_id', id)
    .eq('user_id', req.user.id);

  const { error } = await supabase.from('events').delete().eq('id', id);
  if (error) return res.status(400).json({ error: error.message });

  res.json({ ok: true });
});

export default router;
