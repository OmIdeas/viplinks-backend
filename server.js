import http from 'http';
import { initRealtime } from './realtime.js';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { supabase, supabaseAdmin } from './supabase.js';
import nodemailer from 'nodemailer';
import { Rcon } from 'rcon-client';
import dashboardRouter from './routes/dashboard.js';
import { requireAuth } from './middleware/auth.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: ['https://app.viplinks.org', 'https://www.viplinks.org', 'http://localhost:3000', 'http://www.viplinks.org', 'https://viplinks.org', 'http://localhost:5173'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use('/api/dashboard', requireAuth, dashboardRouter);

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

const transporter = nodemailer.createTransport({
  host: 'smtp.mailgun.org',
  port: 587,
  secure: false,
  auth: {
    user: process.env.MAILGUN_SMTP_USER,
    pass: process.env.MAILGUN_SMTP_PASS
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// ------------------------------
// Helpers de auth y perfiles
// ------------------------------
function makeUsername(email, provided) {
  if (provided && provided.trim()) return provided.trim();
  return (email || '').split('@')[0] || 'user';
}

async function ensureProfile(user) {
  const id = user.id;
  const username = user.user_metadata?.username || makeUsername(user.email);
  const full_name = user.user_metadata?.full_name || username;

  const { data: exists } = await supabaseAdmin
    .from('profiles').select('id').eq('id', id).maybeSingle();

  if (!exists) {
    await supabaseAdmin.from('profiles').insert([{
      id,
      email: user.email,
      username,
      full_name,
      plan: 'free',
      role: 'user'
    }]);
  }
  return { id, email: user.email, username, full_name };
}

function signAppJwt(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendVerificationEmail(email, code) {
  const mailOptions = {
    from: 'VipLinks <postmaster@sandbox3d103bab6c944d8eb6b88e76347f955a.mailgun.org>',
    to: email,
    subject: 'VipLinks - Código de Verificación',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #667eea;">Verificación de Cuenta</h2>
        <p>Tu código de verificación es:</p>
        <div style="background: #f7fafc; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
          <h1 style="color: #2d3748; font-size: 32px; letter-spacing: 8px; margin: 0;">${code}</h1>
        </div>
        <p>Este código expira en 10 minutos.</p>
        <p>Si no solicitaste este código, ignora este email.</p>
      </div>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log('✓ Email sent to:', email);
    return true;
  } catch (error) {
    console.error('✗ Error sending email:', error);
    return false;
  }
}

async function createVerificationCode(userId, email) {
  const { data: lastCode } = await supabaseAdmin
    .from('email_verifications')
    .select('created_at')
    .eq('email', email)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastCode) {
    const timeSinceLastEmail = Date.now() - new Date(lastCode.created_at).getTime();
    if (timeSinceLastEmail < 60000) {
      throw new Error('Esperá un momento antes de solicitar otro código');
    }
  }

  const code = generateOTP();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await supabaseAdmin
    .from('email_verifications')
    .delete()
    .eq('user_id', userId)
    .eq('verified', false);

  const { data, error } = await supabaseAdmin
    .from('email_verifications')
    .insert([{
      user_id: userId,
      email,
      code,
      expires_at: expiresAt.toISOString()
    }])
    .select()
    .single();

  if (error) throw error;

  await sendVerificationEmail(email, code);

  return data;
}

async function getAuthenticatedUser(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) throw new Error('No token provided');
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return { user: decoded, profile_id: decoded.id };
  } catch {
    throw new Error('Invalid token');
  }
}

// ------------------------------
// Helper: Calcular comisiones
// ------------------------------
function calculateCommission(product) {
  const amount = parseFloat(product.price);
  let commissionRate = 0;
  
  if (product.type === 'gaming') {
    // Gaming: 1.3%
    commissionRate = 0.013;
  } else {
    // General: 7% base
    commissionRate = 0.07;
    
    // Si tiene garantía: +2% adicional
    if (product.has_guarantee) {
      commissionRate += 0.02; // Total: 9%
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
    const sess = await getAuthenticatedUser(req);
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

// ------------------------------
// Upload de imágenes a Supabase Storage
// ------------------------------
app.post('/api/upload-image', async (req, res) => {
  try {
    const { file, fileName } = req.body;
    
    if (!file || !fileName) {
      return res.status(400).json({ success: false, error: 'Missing file or fileName' });
    }

    // Verificar autenticación
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    try {
      jwt.verify(token, JWT_SECRET);
    } catch {
      return res.status(401).json({ success: false, error: 'Invalid token' });
    }

    // Convertir base64 a Buffer
    const base64Data = file.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    // Subir a Supabase Storage
    const { data, error } = await supabaseAdmin.storage
      .from('product-images')
      .upload(`products/${fileName}`, buffer, {
        contentType: 'image/jpeg',
        upsert: false
      });

    if (error) {
      console.error('Supabase Storage error:', error);
      return res.status(400).json({ success: false, error: error.message });
    }

    // Obtener URL pública
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
    port: parseInt(port),
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
    port: parseInt(port),
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
    await getAuthenticatedUser(req);

    const { ip, port, password, commands, test_steamid, test_username, test_email } = req.body;

    if (!ip || !port || !password || !commands || !Array.isArray(commands)) {
      return res.json({ 
        success: false, 
        error: 'Faltan datos: ip, port, password, commands' 
      });
    }

    const rcon = new Rcon({ 
      host: ip, 
      port: parseInt(port),
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
// Productos (scope por seller_id)
// ------------------------------
app.get('/api/products', async (req, res) => {
  try {
    const { profile_id } = await getAuthenticatedUser(req);
    
    const { data: products, error } = await supabaseAdmin
      .from('products')
      .select('*')
      .eq('seller_id', profile_id)
      .order('created_at', { ascending: false });
      
    if (error) throw error;

    const adaptedProducts = (products || []).map(product => ({
      id: product.id,
      name: product.name,
      description: product.description,
      price: parseFloat(product.price || 0),
      category: product.type,
      status: product.status,
      deliveryMethod: product.delivery_method,
      hasGuarantee: product.has_guarantee || false,
      created_at: product.created_at,
      image_url: product.image_url,
      views: product.views || 0
    }));

    res.json({ success: true, products: adaptedProducts });
  } catch (error) {
    res.status(401).json({ success: false, error: error.message });
  }
});

app.post('/api/products', async (req, res) => {
  try {
    const { profile_id } = await getAuthenticatedUser(req);
    
    console.log('=== CREATING PRODUCT ===');
    console.log('User profile_id:', profile_id);
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    const productData = {
      seller_id: profile_id,
      name: req.body.name,
      description: req.body.description,
      price: parseFloat(req.body.price),
      currency: req.body.currency || 'USD',
      type: req.body.category || 'gaming',
      category: req.body.category || 'gaming',
      delivery_method: req.body.category === 'gaming' ? 'rcon' : 'manual',
      image_url: req.body.image || null,
      status: req.body.status || 'active',
      product_type: req.body.type,
      server_config: req.body.server || null,
      delivery_commands: req.body.commands || null,
      payment_methods: req.body.payment_methods || null,
      visibility: 'private',
      views: 0,
      sales_count: 0,
      has_guarantee: req.body.category === 'general' && req.body.has_guarantee === true
    };

    const fees = calculateCommission(productData);
    console.log('Product fees:', fees);
    console.log('Product data to insert:', JSON.stringify(productData, null, 2));

    const { data: product, error } = await supabaseAdmin
      .from('products')
      .insert([productData])
      .select()
      .single();

    if (error) {
      console.error('❌ Supabase error:', error);
      throw error;
    }

    console.log('✅ Product created successfully:', product.id);
    
    res.json({ 
      success: true, 
      product,
      fees
    });

  } catch (error) {
    console.error('❌ Error creating product:', error.message);
    console.error('Full error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
});

app.put('/api/products/:id', async (req, res) => {
  try {
    const { profile_id } = await getAuthenticatedUser(req);
    const productId = req.params.id;

    const updateData = { ...req.body, updated_at: new Date().toISOString() };
    if (updateData.category) updateData.type = updateData.category;

    const { data: product, error } = await supabaseAdmin
      .from('products')
      .update(updateData)
      .eq('id', productId)
      .eq('seller_id', profile_id)
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, product });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    const { profile_id } = await getAuthenticatedUser(req);
    const productId = req.params.id;

    const { error } = await supabaseAdmin
      .from('products')
      .delete()
      .eq('id', productId)
      .eq('seller_id', profile_id);

    if (error) throw error;

    res.json({ success: true, message: 'Product deleted successfully' });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// ------------------------------
// Estadísticas
// ------------------------------
app.get('/api/stats', async (req, res) => {
  try {
    const { profile_id } = await getAuthenticatedUser(req);

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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`VipLinks API + Realtime listening on port ${PORT}`);
});
