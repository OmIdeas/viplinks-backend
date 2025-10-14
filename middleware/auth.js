// middleware/auth.js
import jwt from 'jsonwebtoken';

export function requireAuth(req, res, next) {
  const hdr = req.headers.authorization || '';
  if (!hdr.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'MISSING_BEARER_TOKEN' });
  }
  const token = hdr.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const id = payload.id || payload.sub;
    if (!id) return res.status(401).json({ error: 'TOKEN_WITHOUT_ID' });
    req.user = { id, email: payload.email || null, name: payload.name || null };
    next();
  } catch {
    return res.status(401).json({ error: 'INVALID_TOKEN' });
  }
}
