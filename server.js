// ==============================
// VipLinks API - server.js
// ==============================

import http from 'http';
import { initRealtime } from './realtime.js';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { supabase, supabaseAdmin } from './supabase.js';
import nodemailer from 'nodemailer';
import { Rcon } from 'rcon-client';
// Los siguientes imports pueden estar presentes en tu repo; no son usados aquí.
// Mantenerlos no rompe nada (ESM permite imports no usados).
import dashboardRouter from './routes/dashboard.js';
import { requireAuth } from './middleware/auth.js';
import { validatePlayer, executeDeliveryCommands } from './utils/rcon.js';
import productsRoutes from './routes/products.js';
import webhooksRoutes from './routes/webhooks.js';
import brandsRoutes from './routes/brands.js';
import serversRoutes from './routes/servers.js';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import { JWT_SECRET } from './config.js';
import pluginRoutes from './routes/plugin.js';

// ------------------------------
// App base
// ------------------------------
const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
// 🩺 Healthchecks para front y monitores
app.get('/health', (_req, res) => res.json({ ok: true, service: 'viplinks-backend', time: Date.now() }));
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'viplinks-backend', time: Date.now() }));
app.use('/api/servers', serversRoutes);
app.use('/api/plugin', pluginRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/webhooks', webhooksRoutes);
app.use('/api/brands', brandsRoutes);
app.get('/health', (_req, res) => res.json({ ok: true }));

// ------------------------------
// Nodemailer (opcional, solo si hay vars de entorno)
// ------------------------------
let transporter = null;
if (process.env.SMTP_HOST) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: !!(process.env.SMTP_SECURE === 'true'),
    auth: process.env.SMTP_USER && process.env.SMTP_PASS ? {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    } : undefined
  });
}

// ------------------------------
// Helpers mínimos necesarios
// ------------------------------
function getAuthenticatedUser(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) throw new Error('No token provided');
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return { user: decoded, profile_id: decoded.id };
  } catch {
    throw new Error('Invalid token');
  }
}

function signAppJwt(payload) {
  // 7 días por defecto
  return jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256', expiresIn: '7d' });
}

function makeUsername(email, username) {
  const base = (username || (email || '').split('@')[0] || 'user')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '')
    .slice(0, 24);
  return base || 'user';
}

async function ensureProfile(user) {
  // user puede venir de supabase.auth o de decoded jwt
  const id = user.id || user.user?.id || user.user_id;
  const email = user.email || user.user?.email || user.email_confirm || user.user_email;

  if (!id) throw new Error('Missing user id');

  // Buscar perfil
  const { data: existing } = await supabaseAdmin
    .from('profiles')
    .select('id, email, username, full_name, plan, role')
    .eq('id', id)
    .maybeSingle();

  if (existing) return existing;

  // Crear perfil mínimo
  const insert = {
    id,
    email: email || null,
    username: makeUsername(email, null),
    full_name: email ? email.split('@')[0] : 'User',
    plan: 'free',
    role: 'user'
  };

  const { data: created, error: insErr } = await supabaseAdmin
    .from('profiles')
    .insert(insert)
    .select()
    .single();

  if (insErr) throw insErr;
  return created;
}

async function createVerificationCode(userId, email) {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  // invalidar códigos previos no usados
  await supabaseAdmin
    .from('email_verifications')
    .update({ verified: true })
    .eq('user_id', userId)
    .eq('verified', false);

  const { error } = await supabaseAdmin
    .from('email_verifications')
    .insert({
      user_id: userId,
      email,
      code,
      verified: false,
      expires_at: expires
    });

  if (error) throw error;

  // Enviar email solo si hay transporter configurado
  if (transporter && email) {
    try {
      await transporter.sendMail({
        from: process.env.MAIL_FROM || 'Vip Links <support@viplinks.org>',
        to: email,
        subject: 'Tu código de verificación',
        text: `Tu código es: ${code}`,
        html: `<p>Tu código es: <b>${code}</b></p>`
      });
    } catch (e) {
      console.warn('No se pudo enviar email, se continúa igual:', e.message);
    }
  } else {
    console.log(`[DEV] Código de verificación para ${email}: ${code}`);
  }

  return code;
}

// ------------------------------
// Helper: Calcular comisiones
// ------------------------------
function calculateCommission(product) {
  const amount = parseFloat(product.price);
  let commissionRate = 0;

  if (product.type === 'gaming') {
    commissionRate = 0.013;
  } else {
    commissionRate = 0.07;
    if (product.has_guarantee) {
      commissionRate += 0.02;
    }
  }

  const commission = amount * commissionRate;
  const seller_amount = amount - commission;

  return {
    amount,
    commission,
    commission_rate: (commissionRate * 100).toFixed(1) + '%',
    seller_amount
  };
}

// ------------------------------
// Rutas de auth
// ------------------------------
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, username, full_name, name, display_name } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    }

    const meta = {
      username: makeUsername(email, username),
      full_name: full_name || name || display_name || makeUsername(email, username),
      plan: 'free',
      role: 'user'
    };

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: false,
      user_metadata: meta
    });

    if (error) {
      console.error('createUser error:', error);
      return res.status(400).json({
        success: false,
        error: error.message || 'Registration failed'
      });
    }

    if (data?.user) {
      await ensureProfile(data.user);
      await createVerificationCode(data.user.id, email);

      return res.json({
        success: true,
        message: 'Código enviado a tu email',
        requiresVerification: true,
        userId: data.user.id
      });
    }

    return res.status(400).json({ success: false, error: 'Registration failed' });
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message || 'Registration failed' });
  }
});

app.post('/api/auth/verify-code', async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ success: false, error: 'Email and code are required' });
    }

    const { data: verification, error: verifyError } = await supabaseAdmin
      .from('email_verifications')
      .select('*')
      .eq('email', email)
      .eq('code', code)
      .eq('verified', false)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (verifyError || !verification) {
      return res.status(400).json({ success: false, error: 'Código inválido o expirado' });
    }

    await supabaseAdmin
      .from('email_verifications')
      .update({ verified: true })
      .eq('id', verification.id);

    const { error: confirmError } = await supabaseAdmin.auth.admin.updateUserById(
      verification.user_id,
      { email_confirm: true }
    );

    if (confirmError) {
      return res.status(400).json({ success: false, error: 'Error confirmando cuenta' });
    }

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', verification.user_id)
      .single();

    const token = signAppJwt({
      id: profile.id,
      email: profile.email,
      username: profile.username
    });

    return res.json({
      success: true,
      message: 'Cuenta verificada exitosamente',
      user: profile,
      token
    });
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message });
  }
});

app.post('/api/auth/resend-code', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }

    const { data: { users }, error } = await supabaseAdmin.auth.admin.listUsers();
    const user = users?.find(u => u.email === email);

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    if (user.email_confirmed_at) {
      return res.status(400).json({ success: false, error: 'Email already verified' });
    }

    await createVerificationCode(user.id, email);

    return res.json({ success: true, message: 'Código reenviado' });
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required' });
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    const user = data.user;

    if (!user.email_confirmed_at) {
      await createVerificationCode(user.id, email);

      return res.json({
        success: false,
        requiresVerification: true,
        message: 'Código enviado a tu email',
        userId: user.id
      });
    }

    const profile = await ensureProfile(user);
    const token = signAppJwt({ id: profile.id, email: profile.email, username: profile.username });

    return res.json({ success: true, user: profile, token });
  } catch (e) {
    return res.status(401).json({ success: false, error: e.message || 'Login failed' });
  }
});

app.get('/api/auth/me', async (req, res) => {
  try {
    const sess = getAuthenticatedUser(req);
    const { data: prof } = await supabaseAdmin
      .from('profiles')
      .select('id,email,username,full_name,plan,role,created_at')
      .eq('id', sess.profile_id)
      .maybeSingle();

    return res.json({ success: true, user: prof || sess.user });
  } catch {
    return res.status(401).json({ success: false, error: 'Invalid token' });
  }
});

app.post('/api/auth/logout', (_req, res) => {
  return res.json({ success: true, message: 'Logged out successfully' });
});

// ========================================
// CAMBIAR CONTRASEÑA
// ========================================
app.post('/api/auth/change-password', async (req, res) => {
  try {
    const { profile_id } = getAuthenticatedUser(req);
    const { data: { user }, error: authError } =
      await supabaseAdmin.auth.admin.getUserById(profile_id);
    if (authError || !user) return res.status(401).json({ error: 'Token inválido' });

    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Faltan datos' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword
    });

    if (signInError) {
      return res.status(400).json({ error: 'Contraseña actual incorrecta' });
    }

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      user.id,
      { password: newPassword }
    );

    if (updateError) throw updateError;

    console.log(`✅ Contraseña cambiada para: ${user.email}`);
    res.json({ success: true, message: 'Contraseña actualizada' });

  } catch (error) {
    console.error('❌ Error cambiando contraseña:', error);
    res.status(500).json({ error: 'Error al cambiar contraseña' });
  }
});

// ========================================
// 2FA
// ========================================
app.get('/api/auth/2fa/status', async (req, res) => {
  try {
    const { profile_id } = getAuthenticatedUser(req);

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('two_factor_enabled')
      .eq('id', profile_id)
      .single();

    res.json({ enabled: !!profile?.two_factor_enabled });

  } catch (error) {
    console.error('❌ Error verificando 2FA:', error);
    res.status(500).json({ error: 'Error verificando 2FA' });
  }
});

app.post('/api/auth/2fa/enable', async (req, res) => {
  try {
    const { profile_id, user } = getAuthenticatedUser(req);

    const secret = speakeasy.generateSecret({
      name: `VIPLinks (${user.email})`,
      issuer: 'VIPLinks'
    });

    const qrCode = await QRCode.toDataURL(secret.otpauth_url);

    await supabaseAdmin
      .from('profiles')
      .update({
        two_factor_secret_temp: secret.base32
      })
      .eq('id', profile_id);

    res.json({
      secret: secret.base32,
      qrCode: qrCode
    });

  } catch (error) {
    console.error('❌ Error generando 2FA:', error);
    res.status(500).json({ error: 'Error generando 2FA' });
  }
});

app.post('/api/auth/2fa/verify', async (req, res) => {
  try {
    const { profile_id } = getAuthenticatedUser(req);
    const { code } = req.body;

    if (!code || code.length !== 6) {
      return res.status(400).json({ error: 'Código inválido' });
    }

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('two_factor_secret_temp')
      .eq('id', profile_id)
      .single();

    if (!profile?.two_factor_secret_temp) {
      return res.status(400).json({ error: 'No hay configuración 2FA pendiente' });
    }

    const verified = speakeasy.totp.verify({
      secret: profile.two_factor_secret_temp,
      encoding: 'base32',
      token: code,
      window: 2
    });

    if (!verified) {
      return res.status(400).json({ error: 'Código inválido' });
    }

    await supabaseAdmin
      .from('profiles')
      .update({
        two_factor_enabled: true,
        two_factor_secret: profile.two_factor_secret_temp,
        two_factor_secret_temp: null
      })
      .eq('id', profile_id);

    res.json({ success: true, message: '2FA activado' });

  } catch (error) {
    console.error('❌ Error verificando 2FA:', error);
    res.status(500).json({ error: 'Error verificando 2FA' });
  }
});

app.post('/api/auth/2fa/disable', async (req, res) => {
  try {
    const { profile_id } = getAuthenticatedUser(req);

    await supabaseAdmin
      .from('profiles')
      .update({
        two_factor_enabled: false,
        two_factor_secret: null,
        two_factor_secret_temp: null
      })
      .eq('id', profile_id);

    res.json({ success: true, message: '2FA desactivado' });

  } catch (error) {
    console.error('❌ Error desactivando 2FA:', error);
    res.status(500).json({ error: 'Error desactivando 2FA' });
  }
});

// ========================================
// PERFIL
// ========================================
app.put('/api/profile/update', async (req, res) => {
  try {
    const { profile_id, user } = getAuthenticatedUser(req);
    const { username, fullname, phone, bio } = req.body;

    const updates = {};
    if (username) updates.username = username.trim();
    if (fullname) updates.full_name = fullname.trim();
    if (phone !== undefined) updates.phone = String(phone).trim();
    if (bio !== undefined) updates.bio = String(bio).trim();

    const { data: profile, error: updateError } = await supabaseAdmin
      .from('profiles')
      .update(updates)
      .eq('id', profile_id)
      .select()
      .single();

    if (updateError) throw updateError;

    console.log(`✅ Perfil actualizado: ${user.email}`);
    res.json({ success: true, profile });

  } catch (error) {
    console.error('❌ Error actualizando perfil:', error);
    res.status(500).json({ error: 'Error actualizando perfil' });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const { profile_id } = getAuthenticatedUser(req);

    if (!profile_id) return res.status(404).json({ error: 'Perfil no encontrado' });

    const { count: productsCount } = await supabaseAdmin
      .from('products')
      .select('id', { count: 'exact', head: true })
      .eq('seller_id', profile_id);

    const { data: sales } = await supabaseAdmin
      .from('sales')
      .select('amount')
      .eq('seller_id', profile_id)
      .eq('status', 'completed');

    const totalSales = sales?.reduce((sum, sale) => sum + (parseFloat(sale.amount) || 0), 0) || 0;

    res.json({
      stats: {
        productsCount: productsCount || 0,
        totalSales: totalSales
      }
    });

  } catch (error) {
    console.error('❌ Error obteniendo stats:', error);
    res.status(500).json({ error: 'Error obteniendo estadísticas' });
  }
});

// ========================================
// FORMAS DE COBRO
// ========================================
app.get('/api/payment-methods', async (req, res) => {
  try {
    const { profile_id } = getAuthenticatedUser(req);

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id, payment_method')
      .eq('id', profile_id)
      .single();

    if (!profile) return res.status(404).json({ error: 'Perfil no encontrado' });

    res.json({
      paymentMethod: profile.payment_method || null
    });

  } catch (error) {
    console.error('❌ Error obteniendo formas de cobro:', error);
    res.status(500).json({ error: 'Error obteniendo formas de cobro' });
  }
});

app.post('/api/payment-methods', async (req, res) => {
  try {
    const { profile_id, user } = getAuthenticatedUser(req);
    const { type, cbu, alias, holder, cuil, email } = req.body;

    if (!type) {
      return res.status(400).json({ error: 'Tipo de pago requerido' });
    }

    let paymentMethod = { type };

    if (type === 'cbu') {
      if (!cbu && !alias) {
        return res.status(400).json({ error: 'Debes proporcionar CBU o Alias' });
      }
      paymentMethod = { type, cbu, alias, holder, cuil };
    } else if (type === 'paypal') {
      if (!email) {
        return res.status(400).json({ error: 'Email de PayPal requerido' });
      }
      paymentMethod = { type, email };
    }

    await supabaseAdmin
      .from('profiles')
      .update({ payment_method: paymentMethod })
      .eq('id', profile_id);

    res.json({
      success: true,
      message: 'Forma de cobro guardada',
      paymentMethod
    });

  } catch (error) {
    console.error('❌ Error guardando forma de cobro:', error);
    res.status(500).json({ error: 'Error guardando forma de cobro' });
  }
});

// ------------------------------
// Upload de imágenes a Supabase Storage
// ------------------------------
app.post('/api/upload-image', async (req, res) => {
  try {
    const { file, fileName } = req.body;

    if (!file || !fileName) {
      return res.status(400).json({ success: false, error: 'Missing file or fileName' });
    }

    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    try {
      jwt.verify(token, JWT_SECRET);
    } catch {
      return res.status(401).json({ success: false, error: 'Invalid token' });
    }

    const base64Data = file.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    const { data, error } = await supabaseAdmin.storage
      .from('product-images')
      .upload(`products/${fileName}`, buffer, {
        contentType: 'image/jpeg',
        upsert: true,
        cacheControl: '3600'
      });

    if (error) {
      console.error('Supabase Storage error:', error);
      return res.status(400).json({ success: false, error: error.message });
    }

    const { data: urlData } = supabaseAdmin.storage
      .from('product-images')
      .getPublicUrl(`products/${fileName}`);

    return res.json({
      success: true,
      url: urlData.publicUrl,
      path: data.path
    });

  } catch (error) {
    console.error('Upload error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ------------------------------
// RUTAS RCON
// ------------------------------
app.post('/api/rcon/test', async (req, res) => {
  const { ip, port, password } = req.body;

  if (!ip || !port || !password) {
    return res.json({
      success: false,
      error: 'Faltan datos: IP, puerto o password'
    });
  }

  const rcon = new Rcon({
    host: ip,
    port: parseInt(port, 10),
    timeout: 5000
  });

  try {
    await rcon.connect();
    await rcon.authenticate(password);

    const response = await rcon.send('status');
    await rcon.end();

    const serverName = response.match(/hostname:\s*(.+)/i)?.[1]?.trim() ||
                       response.match(/server\s+name:\s*(.+)/i)?.[1]?.trim() ||
                       'Servidor conectado exitosamente';

    res.json({
      success: true,
      server_info: serverName,
      message: 'Conexión RCON exitosa'
    });

  } catch (error) {
    console.error('RCON Test Error:', error);

    let errorMsg = 'Error de conexión';
    if (error.message.includes('authentication')) {
      errorMsg = 'Contraseña RCON incorrecta';
    } else if (error.message.includes('ECONNREFUSED')) {
      errorMsg = 'No se pudo conectar al servidor (verifica IP/puerto)';
    } else if (error.message.includes('timeout')) {
      errorMsg = 'Tiempo de espera agotado';
    }

    res.json({
      success: false,
      error: errorMsg
    });
  }
});

app.post('/api/rcon/execute', async (req, res) => {
  const { ip, port, password, commands, buyer_info } = req.body;

  if (!ip || !port || !password || !commands || !Array.isArray(commands)) {
    return res.json({
      success: false,
      error: 'Faltan datos requeridos'
    });
  }

  const rcon = new Rcon({
    host: ip,
    port: parseInt(port, 10),
    timeout: 5000
  });

  try {
    await rcon.connect();
    await rcon.authenticate(password);

    const results = [];

    for (const cmd of commands) {
      try {
        let processedCmd = cmd;
        if (buyer_info) {
          processedCmd = cmd
            .replace(/{steamid}/g, buyer_info.steamid || '')
            .replace(/{username}/g, buyer_info.username || '')
            .replace(/{email}/g, buyer_info.email || '')
            .replace(/{orderid}/g, buyer_info.orderid || '');
        }

        const response = await rcon.send(processedCmd);
        results.push({
          command: processedCmd,
          success: true,
          response: response || 'Comando ejecutado correctamente'
        });

      } catch (err) {
        results.push({
          command: cmd,
          success: false,
          error: err.message
        });
      }
    }

    await rcon.end();

    res.json({
      success: true,
      results: results,
      executed_count: results.filter(r => r.success).length,
      failed_count: results.filter(r => !r.success).length
    });

  } catch (error) {
    console.error('RCON Execute Error:', error);
    res.json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/rcon/test-execute', async (req, res) => {
  try {
    getAuthenticatedUser(req);

    const { ip, port, password, commands, test_steamid, test_username, test_email } = req.body;

    if (!ip || !port || !password || !commands || !Array.isArray(commands)) {
      return res.json({
        success: false,
        error: 'Faltan datos: ip, port, password, commands'
      });
    }

    const rcon = new Rcon({
      host: ip,
      port: parseInt(port, 10),
      timeout: 5000
    });

    await rcon.connect();
    await rcon.authenticate(password);

    const results = [];

    const buyer_info = {
      steamid: test_steamid || 'STEAM_0:1:12345678',
      username: test_username || 'TestPlayer',
      email: test_email || 'test@example.com',
      orderid: 'TEST_' + Date.now()
    };

    for (const cmd of commands) {
      try {
        const processedCmd = cmd
          .replace(/{steamid}/g, buyer_info.steamid)
          .replace(/{username}/g, buyer_info.username)
          .replace(/{email}/g, buyer_info.email)
          .replace(/{orderid}/g, buyer_info.orderid);

        const response = await rcon.send(processedCmd);
        results.push({
          command: processedCmd,
          success: true,
          response: response || 'Comando ejecutado correctamente'
        });

      } catch (err) {
        results.push({
          command: cmd,
          success: false,
          error: err.message
        });
      }
    }

    await rcon.end();

    res.json({
      success: true,
      message: 'Comandos de prueba ejecutados',
      buyer_info_used: buyer_info,
      results: results,
      executed_count: results.filter(r => r.success).length,
      failed_count: results.filter(r => !r.success).length
    });

  } catch (error) {
    console.error('RCON Test Execute Error:', error);
    res.json({
      success: false,
      error: error.message
    });
  }
});

// ------------------------------
// Estadísticas (Dashboard)
// ------------------------------
app.get('/api/dashboard/stats', async (req, res) => {
  try {
    const { profile_id } = getAuthenticatedUser(req);

    const { data: products, error: productsError } = await supabaseAdmin
      .from('products')
      .select('*')
      .eq('seller_id', profile_id);
    if (productsError) throw productsError;

    const { data: sales, error: salesError } = await supabaseAdmin
      .from('sales')
      .select('*')
      .eq('seller_id', profile_id);
    if (salesError) throw salesError;

    const completedSales = (sales || []).filter(sale => sale.status === 'completed');
    const pendingSales = (sales || []).filter(sale => sale.status === 'pending');
    const totalSales = completedSales.reduce((sum, sale) => sum + parseFloat(sale.amount || 0), 0);
    const totalCommissions = completedSales.reduce((sum, sale) => sum + parseFloat(sale.commission || 0), 0);
    const totalEarnings = completedSales.reduce((sum, sale) => sum + parseFloat(sale.seller_amount || 0), 0);

    const gamingProducts = (products || []).filter(p => p.type === 'gaming').length;
    const generalProducts = (products || []).filter(p => p.type === 'general').length;
    const invitationProducts = (products || []).filter(p => p.type === 'invitation').length;
    const cardProducts = (products || []).filter(p => p.type === 'card').length;

    const gamingSales = completedSales.filter(sale => {
      const product = (products || []).find(p => p.id === sale.product_id);
      return product && product.type === 'gaming';
    });
    const generalSales = completedSales.filter(sale => {
      const product = (products || []).find(p => p.id === sale.product_id);
      return product && product.type === 'general';
    });

    const gamingCommission = gamingSales.length > 0
      ? (gamingSales.reduce((sum, sale) => sum + parseFloat(sale.commission || 0), 0) /
         gamingSales.reduce((sum, sale) => sum + parseFloat(sale.amount || 0), 0)) * 100
      : 1.3;

    const productsCommission = generalSales.length > 0
      ? (generalSales.reduce((sum, sale) => sum + parseFloat(sale.commission || 0), 0) /
         generalSales.reduce((sum, sale) => sum + parseFloat(sale.amount || 0), 0)) * 100
      : 7.0;

    const gamingEarnings = gamingSales.reduce((sum, sale) => sum + parseFloat(sale.seller_amount || 0), 0);
    const productsEarnings = generalSales.reduce((sum, sale) => sum + parseFloat(sale.seller_amount || 0), 0);

    const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const activeGuarantees = completedSales.filter(sale => new Date(sale.created_at) > sevenDaysAgo).length;
    const pendingReleases = pendingSales.reduce((sum, sale) => sum + parseFloat(sale.seller_amount || 0), 0);

    const oneMonthAgo = new Date(); oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    const currentMonthSales = completedSales.filter(sale => new Date(sale.created_at) > oneMonthAgo);
    const salesGrowth = currentMonthSales.length > 0 && completedSales.length > currentMonthSales.length
      ? ((currentMonthSales.length / (completedSales.length - currentMonthSales.length)) * 100).toFixed(1)
      : 0;

    const stats = {
      totalSales,
      totalCommissions,
      totalEarnings,
      gamingCommission: parseFloat(Number(gamingCommission).toFixed(1)),
      productsCommission: parseFloat(Number(productsCommission).toFixed(1)),
      gamingEarnings,
      productsEarnings,
      activeGuarantees,
      pendingReleases,
      invitationSales: invitationProducts,
      salesGrowth: parseFloat(salesGrowth),
      productsCount: (products || []).length,
      gamingProductsCount: gamingProducts,
      generalProductsCount: generalProducts,
      invitationProductsCount: invitationProducts,
      cardProductsCount: cardProducts,
      totalViews: (products || []).reduce((sum, p) => sum + (p.views || 0), 0),
      totalSalesCount: completedSales.length,
      pendingSalesCount: pendingSales.length
    };

    res.json({ success: true, stats });
  } catch (error) {
    res.status(401).json({ success: false, error: error.message });
  }
});

// ------------------------------
// Rutas de debug realtime
// ------------------------------
app.get('/__debug/ping', (req, res) => {
  const io = globalThis.VIP_IO;
  if (!io) return res.status(500).json({ ok: false, error: 'io not ready' });
  const userId = req.query.user;
  const payload = { type: 'debug.http', data: { at: Date.now(), from: 'http' } };
  if (userId) {
    io.to(`user:${userId}`).emit('db:event', payload);
  } else {
    io.to('admins').emit('db:event', payload);
  }
  res.json({ ok: true, sentTo: userId ? `user:${userId}` : 'admins' });
});

app.get('/__debug/pingAll', (req, res) => {
  const io = globalThis.VIP_IO;
  if (!io) return res.status(500).json({ ok: false, error: 'io not ready' });
  const payload = { type: 'debug.all', data: { at: Date.now(), from: 'http' } };
  io.emit('db:event', payload);
  res.json({ ok: true, sentTo: 'ALL' });
});

app.get('/__debug/rooms', (req, res) => {
  const io = globalThis.VIP_IO;
  if (!io) return res.status(500).json({ ok: false, error: 'io not ready' });
  const rooms = Array.from(io.of('/').adapter.rooms.keys());
  const sockets = Array.from(io.of('/').sockets.keys());
  res.json({ ok: true, rooms, sockets });
});

// ------------------------------
// HTTP + Socket.IO
// ------------------------------
const server = http.createServer(app);
const io = initRealtime(server);
globalThis.VIP_IO = io;

// ========================================
// ENDPOINT PÚBLICO: GET PRODUCTO POR ID
// ========================================
app.get('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;

    console.log('Buscando producto:', id);

    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('id', id)
      .eq('status', 'active')
      .single();

    if (error || !data) {
      console.log('Producto no encontrado:', error);
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    const publicData = {
      id: data.id,
      name: data.name,
      description: data.description,
      price: data.price,
      currency: data.currency,
      duration: data.duration,
      type: data.type,
      category: data.category,
      image: data.image,
      features: data.features,
      slug: data.slug,
      created_at: data.created_at,
      brand_name: data.brand_name,
      brand_logo: data.brand_logo,
      background_image: data.background_image,
      brand_colors: data.brand_colors,
      is_physical: data.is_physical || false
    };

    console.log('Producto encontrado:', publicData.name);
    res.json(publicData);

  } catch (error) {
    console.error('Error obteniendo producto:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ========================================
// CREATE PRODUCT (Gaming & General)
// ========================================
app.post(['/api/products', '/api/product', '/api/create-product'], async (req, res) => {
  try {
    const { profile_id } = getAuthenticatedUser(req);
    const b = req.body || {};

    if (!b.name || !b.price || !b.currency) {
      return res.status(400).json({ error: 'Missing: name, price, currency' });
    }

    const product = {
      // dueño
      seller_id: profile_id,
      user_id: profile_id,

      // datos básicos
      name: String(b.name).trim(),
      description: b.description || '',
      price: Number(b.price),
      currency: b.currency || 'USD',
      duration: b.duration || 'permanent',

      // tipo/categoría
      type: (b.type === 'general' || b.category === 'general') ? 'general' : 'gaming',
      category: b.category || ((b.type === 'general') ? 'general' : 'gaming'),

      // media y features
      image: b.image || null,
      features: b.features || null,

      // comandos de entrega y config de servidor (si aplica)
      delivery_commands: Array.isArray(b.commands) ? b.commands : [],
      server_config: (b.rconHost && b.rconPort && b.rconPassword) ? {
        ip: b.rconHost,
        rcon_port: Number(b.rconPort),
        rcon_password: b.rconPassword
      } : null,

      status: b.status || 'active'
    };

    // slug
    product.slug = (product.name || 'product')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '').slice(0, 60);

    const { data, error } = await supabaseAdmin
      .from('products')
      .insert(product)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    return res.status(201).json({
      success: true,
      id: data.id,
      productId: data.id,
      short_code: data.short_code || null
    });
  } catch (e) {
    if (String(e.message || '').toLowerCase().includes('token')) {
      return res.status(401).json({ error: e.message });
    }
    return res.status(500).json({ error: e.message || 'Server error' });
  }
});


// ========================================
// SHORT LINKS - Resolver códigos cortos
// ========================================
app.get('/api/short/:code', async (req, res) => {
  try {
    const { code } = req.params;

    const { data: link, error } = await supabaseAdmin
      .from('short_links')
      .select('product_id, clicks')
      .eq('short_code', code)
      .single();

    if (error || !link) {
      return res.status(404).json({ error: 'Link no encontrado' });
    }

    // Incrementar clicks de forma simple
    await supabaseAdmin
      .from('short_links')
      .update({ clicks: (link.clicks ?? 0) + 1 })
      .eq('short_code', code);

    res.json({ product_id: link.product_id });
  } catch (error) {
    console.error('❌ Error resolviendo short link:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ========================================
// CREATE / UPSERT SHORT LINK
// ========================================
app.post(['/api/short-links', '/api/shortlinks', '/api/links/short'], async (req, res) => {
  try {
    const { profile_id } = getAuthenticatedUser(req);
    const { code, product_id, target_url, active = true } = req.body || {};

    if (!code || (!product_id && !target_url)) {
      return res.status(400).json({ error: 'Missing code and product_id or target_url' });
    }

    // intenta deducir product_id desde ?id=... si no vino explícito
    let pid = product_id;
    if (!pid && target_url) {
      const m = String(target_url).match(/[?&]id=([a-f0-9-]{6,})/i);
      if (m) pid = m[1];
    }

    const insert = {
      short_code: code,
      product_id: pid || null,
      target_url: target_url || null,
      owner_id: profile_id,
      active: !!active
    };

    const { data, error } = await supabaseAdmin
      .from('short_links')
      .upsert(insert, { onConflict: 'short_code' })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    return res.status(201).json({
      success: true,
      short: data.short_code,
      product_id: data.product_id
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Server error' });
  }
});


// ========================================
// CREATE PRODUCT  (evita 404 del front)
// ========================================
app.post('/api/products', async (req, res) => {
  try {
    const { profile_id } = getAuthenticatedUser(req);

    const {
      name,
      description,
      price,
      currency,
      duration,           // 'permanent' | '30' | '60' | '90' | '365' | 'one_time'
      type,               // 'vip' | 'kit' | 'coins' | 'other' (desde front)
      category,           // 'gaming'
      image,
      features,
      commands = [],
      rconHost,
      rconPort,
      rconPassword,
      status = 'active'
    } = req.body;

    if (!name || !price || !currency || !category) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const server_config = (rconHost && rconPort && rconPassword)
      ? { ip: rconHost, rcon_port: rconPort, rcon_password: rconPassword }
      : null;

    const row = {
      seller_id: profile_id,
      user_id: profile_id,
      name,
      description: description || '',
      price: parseFloat(price),
      currency,
      duration: duration || 'permanent',
      type: category === 'gaming' ? 'gaming' : (type || 'gaming'),
      category: category || 'gaming',
      image: image || null,
      features: features || null,
      server_config,
      commands,
      delivery_commands: commands,
      status
    };

    const { data: product, error: insErr } = await supabaseAdmin
      .from('products')
      .insert(row)
      .select('id')
      .single();

    if (insErr) {
      console.error('Supabase insert error (products):', insErr);
      return res.status(500).json({ error: insErr.message });
    }

    // short link automático
    const short_code = Math.random().toString(36).slice(2, 10);
    const { error: linkErr } = await supabaseAdmin
      .from('short_links')
      .insert({
        short_code,
        product_id: product.id,
        active: true,
        clicks: 0
      });

    if (linkErr && linkErr.code !== '23505') {
      console.warn('short_links insert warn:', linkErr.message);
    }

    return res.status(201).json({ id: product.id, short_code });
  } catch (e) {
    console.error('POST /api/products error:', e);
    return res.status(500).json({ error: e.message || 'Server error' });
  }
});

// ========================================
// CREATE SHORT LINK (compat con front)
// ========================================
app.post('/api/short-links', async (req, res) => {
  try {
    const { code, product_id, target_url, active = true } = req.body;

    if (!code) return res.status(400).json({ error: 'code is required' });

    let pid = product_id;
    if (!pid && target_url) {
      try {
        const u = new URL(target_url);
        pid = u.searchParams.get('id');
      } catch {}
    }
    if (!pid) return res.status(400).json({ error: 'product_id or target_url with ?id= is required' });

    const { error } = await supabaseAdmin
      .from('short_links')
      .insert({ short_code: code, product_id: pid, active: !!active, clicks: 0 });

    // si ya existe, 200 para no romper flujo
    if (error && error.code !== '23505') {
      console.error('short_links insert error:', error);
      return res.status(500).json({ error: error.message });
    }
    return res.status(201).json({ code, product_id: pid });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Server error' });
  }
});

// ========================================
// ENDPOINT CRON: PROCESAR ENTREGAS PENDIENTES
// ========================================
app.get('/api/cron/process-deliveries', async (req, res) => {
  try {
    console.log('🤖 Cron Worker - Procesando entregas pendientes');
    console.log('⏰ Ejecutado:', new Date().toISOString());

    function getNextAttemptDelay(createdAt) {
      const elapsed = Date.now() - new Date(createdAt).getTime();
      const minutes = elapsed / 1000 / 60;

      if (minutes < 30) return 10;  // 0-30 min: cada 10 min
      if (minutes < 120) return 20; // 30-120 min: cada 20 min
      return 30;                    // 2-6 horas: cada 30 min
    }

    async function sendGameMessage(serverConfig, message) {
      try {
        const commands = [
          `say "${message}"`,
          `broadcast ${message}`
        ];

        for (const cmd of commands) {
          try {
            await executeDeliveryCommands(serverConfig, [cmd], {});
            console.log(`📢 Mensaje enviado: ${message}`);
            return true;
          } catch (err) {
            continue;
          }
        }
        return false;
      } catch (error) {
        console.error(`❌ Error enviando mensaje:`, error.message);
        return false;
      }
    }

    async function processDelivery(delivery) {
      const {
        id,
        sale_id,
        steam_id,
        commands,
        server_config,
        attempts,
        inventory_fail_count,
        created_at
      } = delivery;

      console.log(`\n📦 Procesando: ${id.slice(0, 8)}...`);
      console.log(`   Steam ID: ${steam_id}`);
      console.log(`   Intento: ${attempts + 1}`);

      try {
        const failCount = inventory_fail_count || 0;

        if (failCount < 3) {
          console.log('📢 Enviando advertencia (1 minuto)...');
          await sendGameMessage(server_config, '⚠️ [VipLinks] Tienes una compra pendiente');
          await new Promise(resolve => setTimeout(resolve, 2000));
          await sendGameMessage(server_config, 'Asegúrate de tener espacio en tu inventario');
          await new Promise(resolve => setTimeout(resolve, 2000));
          await sendGameMessage(server_config, 'La entrega se realizará en 1 minuto...');
          await new Promise(resolve => setTimeout(resolve, 60000)); // 1 min
        } else {
          console.log('📢 Advertencia (4to+ intento)...');
          await sendGameMessage(server_config, '⚠️ [VipLinks] No se pudo completar la entrega');
          await new Promise(resolve => setTimeout(resolve, 2000));
          await sendGameMessage(server_config, 'Se reintentará en los próximos 10 minutos');
          await new Promise(resolve => setTimeout(resolve, 2000));
          await sendGameMessage(server_config, 'Si persiste, contacta al vendedor');
          await new Promise(resolve => setTimeout(resolve, 60000)); // 1 min
        }

        console.log('🎮 Ejecutando comandos...');
        const result = await executeDeliveryCommands(
          server_config,
          commands,
          { player: steam_id, steamid: steam_id, username: steam_id }
        );

        if (result.success) {
          console.log(`✅ Entrega exitosa`);
          await sendGameMessage(server_config, '✅ [VipLinks] ¡Compra entregada!');

          await supabaseAdmin.from('pending_deliveries').update({
            status: 'completed',
            last_attempt: new Date().toISOString()
          }).eq('id', id);

          await supabaseAdmin.from('sales').update({
            delivery_status: 'completed',
            delivered_at: new Date().toISOString()
          }).eq('id', sale_id);

          return { success: true };
        } else {
          throw new Error(result.message || result.error || 'Error desconocido');
        }

      } catch (error) {
        console.error(`❌ Error: ${error.message}`);
        const newAttempts = attempts + 1;
        const newInventoryFailCount = (inventory_fail_count || 0) + 1;
        const now = new Date();
        const expiresAt = new Date(created_at);
        expiresAt.setHours(expiresAt.getHours() + 6);

        if (now >= expiresAt) {
          console.log(`⏰ Expiró (6 horas)`);
          await sendGameMessage(server_config, '⚠️ [VipLinks] Entrega expiró. Contacta al vendedor.');

          await supabaseAdmin.from('pending_deliveries').update({
            status: 'failed',
            attempts: newAttempts,
            inventory_fail_count: newInventoryFailCount,
            last_attempt: now.toISOString(),
            error_message: 'Expiró después de 6 horas'
          }).eq('id', id);

          await supabaseAdmin.from('sales').update({
            delivery_status: 'failed',
            notes: 'Requiere entrega manual por el vendedor.'
          }).eq('id', sale_id);

          return { success: false, expired: true };
        }

        await supabaseAdmin.from('pending_deliveries').update({
          attempts: newAttempts,
          inventory_fail_count: newInventoryFailCount,
          last_attempt: now.toISOString(),
          error_message: error.message
        }).eq('id', id);

        return { success: false, retry: true };
      }
    }

    const { data: deliveries, error } = await supabaseAdmin
      .from('pending_deliveries')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(50);

    if (error) throw error;

    if (!deliveries || deliveries.length === 0) {
      console.log('✅ No hay entregas pendientes');
      return res.json({
        success: true,
        message: 'No hay entregas pendientes',
        processed: 0
      });
    }

    console.log(`📋 ${deliveries.length} entregas pendientes`);

    let completed = 0, failed = 0, retrying = 0;

    for (const delivery of deliveries) {
      if (delivery.last_attempt) {
        const lastAttempt = new Date(delivery.last_attempt);
        const minutesSince = (Date.now() - lastAttempt.getTime()) / 1000 / 60;
        const requiredDelay = getNextAttemptDelay(delivery.created_at);

        if (minutesSince < requiredDelay) {
          const waitTime = Math.ceil(requiredDelay - minutesSince);
          console.log(`⏸️ ${delivery.id.slice(0, 8)}... - Próximo en ${waitTime} min`);
          continue;
        }
      }

      const result = await processDelivery(delivery);

      if (result.success) completed++;
      else if (result.expired) failed++;
      else retrying++;

      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    console.log(`\n📊 Resumen: ✅ ${completed} | ❌ ${failed} | 🔄 ${retrying}`);

    res.json({
      success: true,
      message: 'Worker ejecutado',
      completed,
      failed,
      retrying,
      total: deliveries.length
    });

  } catch (error) {
    console.error('❌ Error en worker:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================
// 🧪 ENDPOINT DE TESTING - SIMULAR COMPRA
// ============================================
app.post('/api/test/simulate-purchase', async (req, res) => {
  try {
    const { productId, steamId, username } = req.body;

    console.log('🧪 TESTING - Simulando compra:', { productId, steamId, username });

    const { data: product, error: productError } = await supabaseAdmin
      .from('products')
      .select('*')
      .eq('id', productId)
      .single();

    if (productError || !product) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    console.log('📦 Producto encontrado:', product.name || product.title);
    console.log('🔍 DEBUG - Producto completo:', JSON.stringify(product, null, 2));
    console.log('📋 Comandos encontrados:', product.commands);

    const isGaming = product.type === 'gaming' || product.category === 'gaming';
    let commissionRate = 0;

    if (isGaming) {
      commissionRate = 0.013; // 1.3% para gaming
    } else {
      commissionRate = 0.07;  // 7% para generales
    }

    const commission = product.price * commissionRate;
    const sellerAmount = product.price - commission;

    console.log(`💰 Precio: $${product.price} | Comisión (${commissionRate * 100}%): $${commission.toFixed(2)} | Vendedor: $${sellerAmount.toFixed(2)}`);

    const { data: sale, error: saleError } = await supabaseAdmin
      .from('sales')
      .insert({
        product_id: productId,
        seller_id: product.user_id,
        buyer_email: `test_${steamId}@testing.com`,
        buyer_steam_id: steamId,
        buyer_username: username,
        amount: product.price,
        commission: commission,
        seller_amount: sellerAmount,
        currency: product.currency || 'ARS',
        payment_id: `TEST_${Date.now()}`,
        payment_method: 'TEST_MODE',
        status: 'completed',
        delivery_status: 'pending',
        kit_delivered: false,
        product_type: product.type || 'gaming'
      })
      .select()
      .single();

    if (saleError) {
      console.error('❌ Error creando venta:', saleError);
      return res.status(500).json({ error: 'Error creando orden de prueba', details: saleError });
    }

    console.log('✅ Venta creada:', sale.id);

    if (product.type === 'gaming' && product.server_config) {
      try {
        console.log('🎮 Intentando entrega RCON...');

        const serverConfig = product.server_config;
        const commands = product.delivery_commands || [];

        if (!serverConfig.ip || !serverConfig.rcon_port || !serverConfig.rcon_password) {
          throw new Error('Configuración de servidor incompleta');
        }

        console.log('🔌 Conectando a:', serverConfig.ip + ':' + serverConfig.rcon_port);

        const rconConfig = {
          ip: serverConfig.ip,
          port: parseInt(serverConfig.rcon_port, 10),
          password: serverConfig.rcon_password
        };

        console.log('🔧 RCON Config:', { ip: rconConfig.ip, port: rconConfig.port, password: '***' });
        console.log('📝 Comandos a ejecutar:', commands.length, 'comando(s):', commands);

        const deliveryResult = await executeDeliveryCommands(
          rconConfig,
          commands,
          {
            steamid: steamId,
            username: username,
            email: 'test@testing.com',
            orderid: sale.id,
            player: steamId
          }
        );

        if (deliveryResult.success) {
          console.log('✅ Entrega RCON exitosa');

          await supabaseAdmin
            .from('sales')
            .update({
              status: 'completed',
              kit_delivered: true,
              delivery_status: 'completed',
              delivered_at: new Date().toISOString()
            })
            .eq('id', sale.id);

          return res.json({
            success: true,
            message: '✅ COMPRA SIMULADA Y ENTREGADA EXITOSAMENTE',
            sale: sale,
            delivery: deliveryResult
          });
        } else {
          throw new Error(deliveryResult.message || deliveryResult.error || 'Error en entrega');
        }

      } catch (rconError) {
        console.error('❌ Error RCON:', rconError.message);

        await supabaseAdmin
          .from('sales')
          .update({
            status: 'failed',
            delivery_status: 'failed',
            error_message: rconError.message,
            notes: `Error RCON de prueba: ${rconError.message}`
          })
          .eq('id', sale.id);

        return res.json({
          success: true,
          message: '⚠️ Venta creada pero entrega RCON falló',
          sale: sale,
          error: rconError.message
        });
      }
    }

    console.log('✅ Producto no requiere entrega RCON');
    return res.json({
      success: true,
      message: '✅ COMPRA SIMULADA (Producto sin RCON)',
      sale: sale
    });

  } catch (error) {
    console.error('❌ Error en simulación de compra:', error);
    res.status(500).json({ error: 'Error en simulación', details: error.message });
  }
});

// ------------------------------
// Iniciar servidor
// ------------------------------
server.listen(PORT, '0.0.0.0', () => {
  console.log(`VipLinks API + Realtime listening on port ${PORT}`);
});



