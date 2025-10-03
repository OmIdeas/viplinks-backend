// realtime.js (ESM)
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import pg from 'pg';
const { Client } = pg;

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

  // 2) Auth por JWT en el handshake
  io.use((socket, next) => {
    try {
      const authHeader = socket.handshake.headers['authorization'] || '';
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers['x-auth-token'] ||
        (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null);

      if (!token) return next(new Error('NO_TOKEN'));
      const payload = jwt.verify(token, process.env.JWT_SECRET);

      socket.user = {
        id: payload.id,
        role: payload.role || 'user',
        sellerId: payload.sellerId || null,
      };
      next();
    } catch {
      next(new Error('BAD_TOKEN'));
    }
  });

  // 3) Rooms útiles
  io.on('connection', (socket) => {
    const { id, role, sellerId } = socket.user;
    socket.join(`user:${id}`);
    if (sellerId) socket.join(`seller:${sellerId}`);
    if (role === 'admin') socket.join('admins');

    io.to('admins').emit('presence:join', { userId: id, at: Date.now() });
    socket.on('disconnect', () => {
      io.to('admins').emit('presence:leave', { userId: id, at: Date.now() });
    });
  });

  console.log('[Realtime] Socket.IO listo');

  // 4) LISTEN/NOTIFY en Postgres (canal: events)
  const pgClient = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('sslmode=require')
      ? { rejectUnauthorized: false }
      : undefined,
  });

  pgClient.connect()
    .then(async () => {
      await pgClient.query('LISTEN events');
      pgClient.on('notification', (msg) => {
        try {
          const payload = JSON.parse(msg?.payload || '{}');
          const { type, userId, sellerId, data } = payload;

          if (userId) io.to(`user:${userId}`).emit('db:event', { type, data });
          if (sellerId) io.to(`seller:${sellerId}`).emit('db:event', { type, data });
          io.to('admins').emit('db:event', { type, data, meta: { userId, sellerId } });
        } catch (e) {
          console.error('[Realtime] Bad PG payload:', e.message);
        }
      });
      console.log('[Realtime] PG LISTEN events listo');
    })
    .catch((e) => {
      console.warn('[Realtime] No se pudo conectar a Postgres para LISTEN/NOTIFY:', e.message);
    });
}
