import crypto from 'crypto';

export const OTPUtils = {
  // Generar código de 6 dígitos
  generate() {
    return crypto.randomInt(100000, 999999).toString();
  },

  // Calcular expiración (10 minutos por defecto)
  getExpiration(minutes = 10) {
    const now = new Date();
    now.setMinutes(now.getMinutes() + minutes);
    return now.toISOString();
  },

  // Verificar si el código expiró
  isExpired(expiresAt) {
    return new Date(expiresAt) < new Date();
  }
};
