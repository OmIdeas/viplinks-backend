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
    return res.json({ ...data, short_url: `${data.domain}/l/${data.path}` });
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
  res.json({ ...data, short_url: `${data.domain}/l/${data.path}` });
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
  res.json({ ...data, short_url: `${data.domain}/l/${data.path}` });
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

/* ========================================================================== */
/* RUTA PÚBLICA: Redirección de short links                                  */
/* Ejemplo: GET /l/abc123 → redirige al target_url                          */
/* ========================================================================== */

router.get('/l/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    
    console.log(`[REDIRECT] Intentando redirigir: /l/${slug}`);
    
    // Buscar el short link en Supabase
    // El path en la BD es solo el slug (sin l/)
    const { data: link, error } = await supabase
      .from('short_links')
      .select('id, target_url, clicks, is_active, domain, path')
      .eq('domain', 'viplinks.org')
      .eq('path', slug)  // Buscar solo el slug
      .eq('is_active', true)
      .maybeSingle();
    
    // Si hay error en la consulta
    if (error) {
      console.error('[REDIRECT] Error en consulta:', error);
      return res.status(500).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Error - VipLinks</title>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { 
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
              display: flex; 
              justify-content: center; 
              align-items: center; 
              height: 100vh; 
              margin: 0;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            }
            .container {
              background: white;
              padding: 40px;
              border-radius: 20px;
              text-align: center;
              box-shadow: 0 20px 60px rgba(0,0,0,0.3);
              max-width: 400px;
            }
            h1 { color: #ef4444; margin-bottom: 20px; font-size: 1.5rem; }
            p { color: #666; margin-bottom: 30px; line-height: 1.6; }
            a { 
              display: inline-block;
              padding: 12px 24px;
              background: #667eea;
              color: white;
              text-decoration: none;
              border-radius: 8px;
              transition: all 0.3s;
            }
            a:hover {
              background: #5568d3;
              transform: translateY(-2px);
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>❌ Error del servidor</h1>
            <p>Ocurrió un error al procesar tu solicitud. Por favor, intenta nuevamente.</p>
            <a href="https://viplinks.org">Ir a VipLinks</a>
          </div>
        </body>
        </html>
      `);
    }
    
    // Si no se encuentra el link
    if (!link) {
      console.log(`[REDIRECT] Short link no encontrado: ${slug}`);
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Link no encontrado - VipLinks</title>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { 
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
              display: flex; 
              justify-content: center; 
              align-items: center; 
              height: 100vh; 
              margin: 0;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            }
            .container {
              background: white;
              padding: 40px;
              border-radius: 20px;
              text-align: center;
              box-shadow: 0 20px 60px rgba(0,0,0,0.3);
              max-width: 400px;
            }
            h1 { color: #667eea; margin-bottom: 20px; font-size: 1.5rem; }
            p { color: #666; margin-bottom: 30px; line-height: 1.6; }
            a { 
              display: inline-block;
              padding: 12px 24px;
              background: #667eea;
              color: white;
              text-decoration: none;
              border-radius: 8px;
              transition: all 0.3s;
            }
            a:hover {
              background: #5568d3;
              transform: translateY(-2px);
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>🔗 Link no encontrado</h1>
            <p>El link que intentas acceder no existe o ha expirado. Verifica la URL e intenta nuevamente.</p>
            <a href="https://viplinks.org">Ir a VipLinks</a>
          </div>
        </body>
        </html>
      `);
    }
    
    // Incrementar contador de clicks (async, no espera respuesta)
    supabase
      .from('short_links')
      .update({ 
        clicks: (link.clicks || 0) + 1,
        updated_at: new Date().toISOString()
      })
      .eq('id', link.id)
      .then(({ error: updateError }) => {
        if (updateError) {
          console.error('[REDIRECT] Error incrementando clicks:', updateError);
        }
      });
    
    console.log(`[REDIRECT] ✅ Redirigiendo /l/${slug} → ${link.target_url}`);
    
    // Redirigir (301 = permanente, 302 = temporal)
    // Usar 301 para mejor SEO y caché
    res.redirect(301, link.target_url);
    
  } catch (error) {
    console.error('[REDIRECT] Excepción no manejada:', error);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Error - VipLinks</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
            display: flex; 
            justify-content: center; 
            align-items: center; 
            height: 100vh; 
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          }
          .container {
            background: white;
            padding: 40px;
            border-radius: 20px;
            text-align: center;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            max-width: 400px;
          }
          h1 { color: #ef4444; margin-bottom: 20px; font-size: 1.5rem; }
          p { color: #666; margin-bottom: 30px; line-height: 1.6; }
          a { 
            display: inline-block;
            padding: 12px 24px;
            background: #667eea;
            color: white;
            text-decoration: none;
            border-radius: 8px;
            transition: all 0.3s;
          }
          a:hover {
            background: #5568d3;
            transform: translateY(-2px);
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>❌ Error del servidor</h1>
          <p>Ocurrió un error inesperado. Por favor, intenta nuevamente más tarde.</p>
          <a href="https://viplinks.org">Ir a VipLinks</a>
        </div>
      </body>
      </html>
    `);
  }
});

export default router;
