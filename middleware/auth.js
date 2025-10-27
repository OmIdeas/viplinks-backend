import jwt from 'jsonwebtoken';
// 1. IMPORTAMOS EL SECRETO COMPARTIDO
import { JWT_SECRET } from '../config.js'; 

// 2. ELIMINAMOS CUALQUIER SECRETO ANTIGUO QUE ESTUVIERA AQUÍ
// const JWT_SECRET = process.env.JWT_SECRET || '...'; // <--- BORRADO

export function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    // 3. Usamos el secreto importado para verificar
    const decoded = jwt.verify(token, JWT_SECRET); 
    
    // Adjuntamos los datos decodificados (id, email, etc.) al request
    // para que las rutas (como /api/servers) puedan usarlo.
    req.user = decoded; 
    
    // Súper importante: Adjuntamos el ID del perfil para que las rutas lo usen
    req.profile_id = decoded.id; 

    next(); // El token es válido, continuar
  } catch (error) {
    console.error('Error de autenticación:', error.message);
    return res.status(401).json({ error: 'Invalid token' });
  }
}
