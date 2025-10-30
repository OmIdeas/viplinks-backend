import express from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Rcon } from 'rcon-client';
import { supabaseAdmin } from '../supabase.js';
import { JWT_SECRET } from '../config.js';

const router = express.Router();

// ------------------------------
// Helper: usuario autenticado
// ------------------------------
async function getAuthenticatedUser(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) throw new Error('No token provided');
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // decoded.id = id del perfil (auth.users.id)
    return { user: decoded, profile_id: decoded.id };
  } catch {
    throw new Error('Invalid token');
  }
}

// ------------------------------
// GET /api/servers  (listar)
// ------------------------------
router.get('/', async (req, res) => {
  try {
    const { profile_id } = await getAuthenticatedUser(req);

    const { data: servers, error } = await supabaseAdmin
      .from('servers')
      .select('id, server_name, server_ip, rcon_port, server_key, last_connection_status, last_connection_message, game_type, created_at, updated_at')
      .eq('user_id', profile_id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(servers || []);
  } catch (error) {
    console.error('❌ Error listando servidores:', error.message);
    res.status(401).json({ error: error.message });
  }
});

// ------------------------------
// POST /api/servers  (crear)
// ------------------------------
router.post('/', async (req, res) => {
  try {
    const { profile_id } = await getAuthenticatedUser(req);
    const { server_name, server_ip, rcon_port, rcon_password, game_type } = req.body;

    if (!server_name || !server_ip || !rcon_port || !rcon_password) {
      return res.status(400).json({ error: 'Faltan campos requeridos' });
    }

    // 1) ServerKey única
    const server_key = 'vl_key_' + crypto.randomBytes(24).toString('hex');

    // 2) Insert
    const { data: savedServer, error } = await supabaseAdmin
      .from('servers')
      .insert({
        user_id: profile_id,
        server_name,
        server_ip,
        rcon_port: parseInt(rcon_port, 10),
        rcon_password,                  // se guarda, NO se devuelve
        server_key,
        game_type: game_type || 'rust',
        last_connection_status: 'pending',
        last_connection_message: 'Pendiente de testeo'
      })
      .select('id, server_name, server_ip, rcon_port, server_key, last_connection_status, last_connection_message, game_type')
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(400).json({ error: 'Error al generar la clave, intenta de nuevo' });
      }
      throw error;
    }

    res.status(201).json(savedServer);
  } catch (error) {
    console.error('❌ Error guardando servidor:', error.message);
    res.status(400).json({ error: error.message });
  }
});

// ------------------------------
// DELETE /api/servers/:id
// ------------------------------
router.delete('/:id', async (req, res) => {
  try {
    const { profile_id } = await getAuthenticatedUser(req);
    const { id } = req.params;

    const { error } = await supabaseAdmin
      .from('servers')
      .delete()
      .eq('id', id)
      .eq('user_id', profile_id);

    if (error) throw error;
    res.json({ success: true, message: 'Servidor eliminado' });
  } catch (error) {
    console.error('❌ Error eliminando servidor:', error.message);
    res.status(400).json({ error: error.message });
  }
});

// ------------------------------
// POST /api/servers/test  (probar RCON)
// body: { serverId }
// ------------------------------
router.post('/test', async (req, res) => {
  let serverId = '';
  try {
    const { profile_id } = await getAuthenticatedUser(req);
    serverId = req.body.serverId;

    if (!serverId) {
      return res.status(400).json({ error: 'Falta serverId' });
    }

    const { data: server, error: fetchError } = await supabaseAdmin
      .from('servers')
      .select('server_ip, rcon_port, rcon_password')
      .eq('id', serverId)
      .eq('user_id', profile_id)
      .single();

    if (fetchError || !server) {
      return res.status(404).json({ error: 'Servidor no encontrado' });
    }

    const { server_ip, rcon_port, rcon_password } = server;
    const rcon = new Rcon({ host: server_ip, port: parseInt(rcon_port, 10), timeout: 30000 });

    try {
      await rcon.connect();
      await rcon.authenticate(rcon_password);
      await rcon.send('status');
      await rcon.end();

      // actualización de estado (no bloqueante)
      await supabaseAdmin.from('servers')
        .update({ last_connection_status: 'success', last_connection_message: 'Conexión exitosa' })
        .eq('id', serverId);

      return res.json({ success: true, message: 'Conexión RCON exitosa' });
    } catch (err) {
      let errorMsg = 'Error de conexión';
      const m = err?.message || '';
      if (m.includes('authentication')) errorMsg = 'Contraseña RCON incorrecta';
      else if (m.includes('ECONNREFUSED')) errorMsg = 'No se pudo conectar (verifica IP/puerto)';
      else if (m.includes('timeout')) errorMsg = 'Tiempo de espera agotado';

      await supabaseAdmin.from('servers')
        .update({ last_connection_status: 'error', last_connection_message: errorMsg })
        .eq('id', serverId);

      return res.status(400).json({ success: false, error: errorMsg });
    }
  } catch (error) {
    console.error('❌ Error testeando servidor:', error.message, 'serverId=', serverId);
    res.status(400).json({ error: error.message });
  }
});

export default router;
