// realtime.js
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { Client } = require('pg');

function initRealtime(httpServer) {
  // --- 1) Socket.IO
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.FRONTEND_ORIGIN || '*',
      methods: ['GET', 'POST'],
    },
    pingInterval: 25000,
    pingTimeout: 20000,
  });

  // --- 2) Autenticación por JWT en el handshake
  io.use((socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers['x-auth-token'] ||
        (socket.handshake.headers['authorization'] || '').split(' ')[1];

      if (!token) return next(new Error('NO_TOKEN'));
      const payload = jwt.verify(token, process.env.JWT_SECRET);

      socket.user = {
        id: payload.id,
        role: payload.role || 'user',
        sellerId: payload.sellerId || null,
      };
      next();
    } catch (e) {
      next(new Error('BAD_TOKEN'));
    }
  });

  // --- 3) Rooms útiles
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

  // --- 4) Conexión a Postgres para LISTEN/NOTIFY (canal: events)
  const pg = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('sslmode=require')
      ? { rejectUnauthorized: false }
      : undefined,
  });

  pg.connect()
    .then(async () => {
      await pg.query('LISTEN events');
      pg.on('notification', (msg) => {
        try {
          const payload = JSON.parse(msg.payload || '{}');
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

  return io;
}

module.exports = { initRealtime };
