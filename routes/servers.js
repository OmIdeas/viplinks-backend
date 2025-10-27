import express from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Rcon } from 'rcon-client';
import { supabaseAdmin } from '../supabase.js';
import { JWT_SECRET } from '../config.js'; //

const router = express.Router();

// ------------------------------
// Helper: Obtener usuario autenticado
// ------------------------------
// (Este helper es el mismo que usas en products.js y server.js)
async function getAuthenticatedUser(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) throw new Error('No token provided');
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // Usamos decoded.id que es el ID del perfil (que es el auth.users.id)
    return { user: decoded, profile_id: decoded.id };
  } catch {
    throw new Error('Invalid token');
  }
}

// ------------------------------
// GET /api/servers - Listar servidores del usuario
// ------------------------------
router.get('/', async (req, res) => {
  try {
    const { profile_id } = await getAuthenticatedUser(req);

    const { data: servers, error } = await supabaseAdmin
      .from('servers')
      .select(
        // Importante: NO devolvemos rcon_password al frontend
        'id, server_name, server_ip, rcon_port, server_key, last_connection_status, last_connection_message, game_type, created_at'
      )
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
// POST /api/servers - Guardar un nuevo servidor
// ------------------------------
router.post('/', async (req, res) => {
  try {
    const { profile_id } = await getAuthenticatedUser(req);
    const { server_name, server_ip, rcon_port, rcon_password } = req.body;

    if (!server_name || !server_ip || !rcon_port || !rcon_password) {
      return res.status(400).json({ error: 'Faltan campos requeridos' });
    }

    // 1. Generar la ServerKey única
    const server_key = 'vl_key_' + crypto.randomBytes(24).toString('hex');

    // 2. Crear el objeto del servidor
    const newServer = {
      user_id: profile_id,
      server_name,
      server_ip,
      rcon_port: parseInt(rcon_port),
      // Guardamos la contraseña RCON (como haces en products.js)
      rcon_password, 
      server_key,
      last_connection_status: 'pending',
      last_connection_message: 'Pendiente de testeo'
    };

    // 3. Insertar en la base de datos
    const { data: savedServer, error } = await supabaseAdmin
      .from('servers')
      .insert(newServer)
      .select(
        // Devolvemos la info (sin la contraseña rcon)
        'id, server_name, server_ip, rcon_port, server_key, last_connection_status, last_connection_message'
      )
      .single();

    if (error) {
      if (error.code === '23505') { // Error de clave única
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
// DELETE /api/servers/:id - Eliminar un servidor
// ------------------------------
router.delete('/:id', async (req, res) => {
  try {
    const { profile_id } = await getAuthenticatedUser(req);
    const { id } = req.params;

    const { error } = await supabaseAdmin
      .from('servers')
      .delete()
      .eq('id', id)
      .eq('user_id', profile_id); // RLS ya protege, pero es doble seguro

    if (error) throw error;

    res.json({ success: true, message: 'Servidor eliminado' });

  } catch (error) {
    console.error('❌ Error eliminando servidor:', error.message);
    res.status(400).json({ error: error.message });
  }
});

// ------------------------------
// POST /api/servers/test - Testear conexión RCON
// ------------------------------
router.post('/test', async (req, res) => {
  let serverId = '';
  try {
    const { profile_id } = await getAuthenticatedUser(req);
    serverId = req.body.serverId;

    if (!serverId) {
      return res.status(400).json({ error: 'Falta serverId' });
    }

    // 1. Buscar el servidor en la DB para obtener credenciales
    // Esto es seguro, el usuario no envía la contraseña, solo el ID
    const { data: server, error: fetchError } = await supabaseAdmin
      .from('servers')
      .select('server_ip, rcon_port, rcon_password')
      .eq('id', serverId)
      .eq('user_id', profile_id)
      .single();

    if (fetchError || !server) {
      return res.status(404).json({ error: 'Servidor no encontrado' });
    }

    // 2. Testear RCON (lógica copiada de tu server.js)
    const { server_ip, rcon_port, rcon_password } = server;

    const rcon = new Rcon({ 
      host: server_ip, 
      port: parseInt(rcon_port),
      timeout: 5000 
    });

    let statusUpdate = {};

    try {
      await rcon.connect();
      await rcon.authenticate(rcon_password);
      await rcon.send('status'); // Enviamos un comando simple
      await rcon.end();
      
      // 3. Conexión exitosa
      statusUpdate = {
        last_connection_status: 'success',
        last_connection_message: 'Conexión exitosa'
      };
      
      res.json({ success: true, message: 'Conexión RCON exitosa' });
      
    } catch (error) {
      console.error('RCON Test Error:', error.message);
      
      let errorMsg = 'Error de conexión';
      if (error.message.includes('authentication')) {
        errorMsg = 'Contraseña RCON incorrecta';
      } else if (error.message.includes('ECONNREFUSED')) {
        errorMsg = 'No se pudo conectar (verifica IP/puerto)';
      } else if (error.message.includes('timeout')) {
        errorMsg = 'Tiempo de espera agotado';
      }

      // 4. Conexión fallida
      statusUpdate = {
        last_connection_status: 'error',
        last_connection_message: errorMsg
      };
      
      res.status(400).json({ success: false, error: errorMsg });
    }

    // 5. Actualizar estado en la DB (sin esperar)
    await supabaseAdmin
      .from('servers')
      .update(statusUpdate)
      .eq('id', serverId);

  } catch (error) {
    console.error('❌ Error testeando servidor:', error.message);
    res.status(400).json({ error: error.message });
  }
});

export default router;
