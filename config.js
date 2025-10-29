// Este es el "secreto" que usaremos para firmar y verificar los tokens de sesión.
// Lo ponemos aquí para que server.js y cualquier archivo en routes/ lo puedan importar
// y estemos seguros de que SIEMPRE es el mismo.
const VIPLINKS_CONFIG = {
  BACKEND_URL: 'https://viplinks-backend-production.up.railway.app',
  PUBLIC_ROOT: 'https://viplinks.org'
};

export const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';
