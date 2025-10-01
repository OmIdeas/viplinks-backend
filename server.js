import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';

const app = express();
const PORT = process.env.PORT || 3000;

// ===== CORS =====
app.use(cors({
  origin: ['https://app.viplinks.org', 'http://localhost:3000'],
  credentials: true
}));
app.use(express.json());

// ===== Supabase clients =====
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnon = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseAnon, {
  auth: { persistSession: false, autoRefreshToken: false }
});

// Admin (Service Role) para perfilar y DB sin pelear con RLS
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRole);

// ===== JWT propio de tu app =====
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

// ===== EMAIL CONFIG =====
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// ===== Health =====
app.get('/api/health', (_req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// ===== Helpers =====
function makeUsername(email, provided) {
  if (provided && provided.trim()) return provided.trim();
  return (email || '').split('@')[0] || 'user';
}

async function ensureProfile(user) {
  // Crea perfil espejo en tu tabla "profiles" si no existe (id = auth.users.id)
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

// ===== OTP Functions =====
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendVerificationEmail(email, code) {
  const mailOptions = {
    from: process.env.SMTP_USER,
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
    return true;
  } catch (error) {
    console.error('Error sending email:', error);
    return false;
  }
}

async function createVerificationCode(userId, email) {
  const code = generateOTP();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  // VERIFICAR último código enviado
  const { data: lastCode } = await supabaseAdmin
    .from('email_verifications')
    .select('created_at')
    .eq('email', email)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastCode) {
    const timeSinceLastEmail = Date.now() - new Date(lastCode.created_at).getTime();
    if (timeSinceLastEmail < 60000) { // 60 segundos
      throw new Error('Esperá un momento antes de solicitar otro código');
    }
  }

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
    const decoded = jwt.verify(token, JWT_SECRET); // { id, email, username }
    return { user: decoded, profile_id: decoded.id };
  } catch {
    throw new Error('Invalid token');
  }
}

// ================= AUTENTICACIÓN (con Supabase Auth) =================

// REGISTRO — usa GoTrue; si falla, devuelve 400 y NO emite token
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

// VERIFICAR CÓDIGO
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

// REENVIAR CÓDIGO
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

// LOGIN — requiere email confirmado
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

// ME — basado en tu JWT propio
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

// ================= PRODUCTOS =================

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
      hasGuarantee: false,
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

    const productData = {
      seller_id: profile_id,
      name: req.body.name,
      description: req.body.description,
      price: parseFloat(req.body.price),
      type: req.body.category || 'gaming',
      category: req.body.category || 'gaming',
      delivery_method: 'rcon',
      image_url: req.body.image || null,
      status: req.body.status || 'active',
      
      // Campos gaming específicos
      product_type: req.body.type,
      duration: req.body.duration,
      server_config: req.body.server || null,
      delivery_commands: req.body.commands || null,
      payment_methods: req.body.payment_methods || null,
      visibility: 'private',
      views: 0,
      sales_count: 0
    };

    const { data: product, error } = await supabaseAdmin
      .from('products')
      .insert([productData])
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, product });
  } catch (error) {
    console.error('Error creating product:', error);
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

// ================= ESTADÍSTICAS =================

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

// ================= VENTAS =================

app.post('/api/sales', async (req, res) => {
  try {
    const { profile_id } = await getAuthenticatedUser(req);

    const saleData = {
      product_id: req.body.product_id,
      seller_id: profile_id,
      buyer_email: req.body.buyer_email,
      amount: req.body.amount,
      commission: req.body.commission,
      seller_amount: req.body.seller_amount,
      payment_id: req.body.payment_id,
      payment_method: req.body.payment_method || 'mercadopago',
      status: req.body.status || 'pending'
    };

    const { data: sale, error } = await supabaseAdmin
      .from('sales')
      .insert([saleData])
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, sale });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`VipLinks API running on port ${PORT}`);
});

