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
  // admite objeto contact o campos planos
  if (body.contact && typeof body.contact === 'object') {
    const c = body.contact;
    return {
      website: c.website ?? null,
      phone: c.phone ?? null,
      whatsapp_number: c.whatsapp_number ?? c.whatsapp ?? null,
      // aceptar 'whatsapp_message' además de 'whatsapp_text'
      whatsapp_text: c.whatsapp_text ?? c.whatsapp_message ?? null,
    };
  }
  return {
    website: body.contact_website ?? body.website ?? null,
    phone: body.contact_phone ?? body.phone ?? null,
    whatsapp_number: body.contact_whatsapp ?? body.whatsapp ?? null,
    whatsapp_text:
      body.contact_whatsapp_text ??
      body.whatsapp_text ??
      body.whatsapp_message ??
      null,
  };
}

function normalizeSocial(body) {
  if (body.social && typeof body.social === 'object') {
    const s = body.social;
    return {
      instagram: s.instagram ?? null,
      tiktok: s.tiktok ?? null,
      facebook: s.facebook ?? null,
      other: s.other ?? null,
    };
  }
  return {
    instagram: body.social_instagram ?? body.instagram ?? null,
    tiktok: body.social_tiktok ?? body.tiktok ?? null,
    facebook: body.social_facebook ?? body.facebook ?? null,
    other: body.social_other ?? body.other ?? null,
  };
}

function normalizeInsertPayload(body, userId) {
  // Soportar front nuevo: body.theme, body.mode, body.qr, body.start_at/end_at
  const theme = (body.theme && typeof body.theme === 'object') ? body.theme : {};
  const qr    = (body.qr    && typeof body.qr    === 'object') ? body.qr    : {};

  const mode = body.mode || body.event_mode || null;
  const explicitIsOnline = (typeof body.is_online === 'boolean') ? body.is_online : null;
  const isOnline =
    mode ? (mode === 'online') : (explicitIsOnline ?? true);

  // Si el front envía link para eventos online y tu tabla lo admite como 'online_link',
  // puedes añadir la columna aquí. Si tu tabla NO la tiene, no lo incluyas.
  // const online_link = isOnline ? (body.link ?? body.online_link ?? null) : null;

  // Si envían imagen de fondo en theme, la usamos como bg_type 'image', si no color
  const themeHasImage = !!theme.bg_image_url;
  const resolvedBgType  = body.bg_type ?? (themeHasImage ? 'image' : 'color');
  const resolvedBgValue = body.bg_value ?? (themeHasImage ? theme.bg_image_url : (theme.bg_color ?? null));

  return {
    user_id: userId,

    name: body.name,
    description: body.description ?? null,

    // cover_url plano o dentro de theme
    cover_url: body.cover_url ?? theme.cover_url ?? null,

    // aceptar ambas convenciones
    starts_at: body.starts_at ?? body.start_at ?? null,
    ends_at:   body.ends_at   ?? body.end_at   ?? null,

    bg_type:   resolvedBgType,                // 'color' | 'image'
    bg_value:  resolvedBgValue,               // hex o url
    text_color: body.text_color ?? theme.text_color ?? '#111827',

    is_online: isOnline,
    address:   isOnline ? null : (body.address ?? null),
    lat:       toNum(body.lat),
    lng:       toNum(body.lng),
    map_zoom:  toNum(body.map_zoom) ?? 14,

    // QR simple (si el front manda un builder más complejo, al menos tomamos lo básico)
    show_qr:        (typeof body.show_qr === 'boolean') ? body.show_qr
                    : (typeof qr.show_main === 'boolean') ? qr.show_main
                    : true,
    use_custom_qr:  (typeof body.use_custom_qr === 'boolean') ? body.use_custom_qr : false,
    custom_qr_url:  body.custom_qr_url ?? qr.pay_qr_url ?? null,

    contact: normalizeContact(body),
    social:  normalizeSocial(body),

    // Si agregas online_link en tu tabla, descomenta:
    // online_link
  };
}

function normalizeUpdatePayload(body) {
  const upd = { ...body };

  // aceptar start_at/end_at también en updates
  if ('start_at' in upd && !('starts_at' in upd)) upd.starts_at = upd.start_at;
  if ('end_at'   in upd && !('ends_at'   in upd)) upd.ends_at   = upd.end_at;

  // mapear theme si viene en updates
  if (upd.theme && typeof upd.theme === 'object') {
    const t = upd.theme;
    if (t.cover_url && !upd.cover_url) upd.cover_url = t.cover_url;

    const hasImg = !!t.bg_image_url;
    if (!upd.bg_type)  upd.bg_type  = hasImg ? 'image' : 'color';
    if (!upd.bg_value) upd.bg_value = hasImg ? t.bg_image_url : (t.bg_color ?? null);
    if (!upd.text_color && t.text_color) upd.text_color = t.text_color;
    delete upd.theme;
  }

  // Normalizar tipos numéricos si vinieron como string
  if ('lat' in upd) upd.lat = toNum(upd.lat);
  if ('lng' in upd) upd.lng = toNum(upd.lng);
  if ('map_zoom' in upd) upd.map_zoom = toNum(upd.map_zoom);

  // Contacto/redes si vienen planos
  if (!upd.contact) upd.contact = normalizeContact(upd);
  if (!upd.social)  upd.social  = normalizeSocial(upd);

  // Manejar 'mode' en updates
  if ('mode' in upd && !('is_online' in upd)) {
    upd.is_online = (upd.mode === 'online');
    if (upd.is_online) upd.address = null;
    delete upd.mode;
  }

  // Evitar que intenten cambiar user_id
  delete upd.user_id;

  return upd;
}

/* ---------------- Rutas ---------------- */

// GET /api/events -> lista SOLO del usuario autenticado
router.get('/', auth, async (req, res) => {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('user_id', req.user.id)
    .order('starts_at', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// POST /api/events -> crea un evento
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
    res.json({ success: true, event: data });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Bad request' });
  }
});

// PATCH /api/events/:id -> edita campos del evento (solo dueño)
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
  res.json({ success: true, event: data });
});

// DELETE /api/events/:id -> borra el evento y sus short_links
router.delete('/:id', auth, async (req, res) => {
  const { id } = req.params;

  const { data: ev, error: e1 } = await supabase
    .from('events')
    .select('id,user_id')
    .eq('id', id)
    .single();

  if (e1 || !ev) return res.status(404).json({ error: 'Not found' });
  if (ev.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

  // Borrar shorts vinculados del mismo user (si existen)
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
