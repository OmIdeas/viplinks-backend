// middlewares/auth.js  (ESM, compatible con "type": "module")
import jwt from 'jsonwebtoken';

export default function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const uid =
      payload.sub ||
      payload.id ||
      payload.user_id ||
      payload.userId;

    if (!uid) return res.status(401).json({ error: 'Invalid token (no sub)' });

    req.user = { id: uid };
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Bad token' });
  }
}
