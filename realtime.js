// /realtime.js
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import pgPkg from 'pg';
const { Client } = pgPkg;

export function initRealtime(httpServer) {
  // 1) Socket.IO
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.FRONTEND_ORIGIN || '*',
      methods: ['GET', 'POST'],
    },
    pingInterval: 25000,
    pingTimeout: 20000,
  });

  // Hacemos visible el io para rutas de debug (/__debug/*)
  globalThis.VIP_IO = io;

  // 2) Auth por token en handshake (acepta id o sub)
  io.use((socket, next) => {
    try {
      const hdr = socket.handshake.headers || {};
      const token =
        (socket.handshake.auth && socket.handshake.auth.token) ||
        hdr['x-auth-token'] ||
        (hdr['authorization'] || '').split(' ')[1];

      if (!token) return next(new Error('NO_TOKEN'));

      let payload;
      try {
        // 1º intento: verificar con tu JWT_SECRET (token propio del backend)
        payload = jwt.verify(token, process.env.JWT_SECRET);
      } catch {
        // 2º intento: decodificar sin verificar (p.ej. tokens de Supabase traen `sub`)
        try { payload = jwt.decode(token) || {}; } catch { payload = {}; }
      }

      const uid =
        payload.id || payload.sub || payload.user_id || payload.userId || null;

      if (!uid) return next(new Error('BAD_TOKEN'));

      socket.user = {
        id: uid,
        role: payload.role || 'user',
        sellerId: payload.sellerId || null,
      };
      next();
    } catch {
      next(new Error('BAD_TOKEN'));
    }
  });

  // 3) Rooms
  io.on('connection', (socket) => {
    const { id, role, sellerId } = socket.user || {};
    if (id) socket.join(`user:${id}`);
    if (sellerId) socket.join(`seller:${sellerId}`);
    if (role === 'admin') socket.join('admins');

    io.to('admins').emit('presence:join', { userId: id, at: Date.now() });
    socket.on('disconnect', () => {
      io.to('admins').emit('presence:leave', { userId: id, at: Date.now() });
    });
  });

  console.log('[Realtime] Socket.IO listo');

  // 4) LISTEN/NOTIFY en Postgres (canal: events)
  const pg = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('sslmode=require')
      ? { rejectUnauthorized: false }
      : undefined,
  });

  pg.connect()
    .then(async () => {
      await pg.query('LISTEN events');
      console.log('[Realtime] PG LISTEN events listo');

      pg.on('notification', (msg) => {
        console.log('[Realtime] PG payload:', msg.channel, msg.payload);
        try {
          const payload = JSON.parse(msg?.payload || '{}');
          const { type, userId, sellerId, data } = payload;

          if (userId)  io.to(`user:${userId}`).emit('db:event', { type, data });
          if (sellerId) io.to(`seller:${sellerId}`).emit('db:event', { type, data });
          io.to('admins').emit('db:event', { type, data, meta: { userId, sellerId } });
        } catch (e) {
          console.error('[Realtime] Bad PG payload:', e.message);
        }
      });
    })
    .catch((e) => {
      console.warn('[Realtime] No se pudo conectar a Postgres para LISTEN/NOTIFY:', e.message);
    });

  return io;
}
