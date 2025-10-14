// middleware/auth.js
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

export function requireAuth(req, res, next) {
  const hdr = req.headers.authorization || '';
  if (!hdr.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'MISSING_BEARER_TOKEN' });
  }

  const token = hdr.slice(7).trim();
  if (!token) return res.status(401).json({ error: 'EMPTY_TOKEN' });

  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    const id = payload.id || payload.sub;
    if (!id) return res.status(401).json({ error: 'TOKEN_WITHOUT_ID' });

    req.user = {
      id,
      email: payload.email || null,
      name:  payload.name  || payload.username || null,
    };

    return next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'INVALID_TOKEN' });
  }
}
