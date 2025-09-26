import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';

const app = express();
const PORT = process.env.PORT || 3000;

// CORS - IMPORTANTE para que funcione desde app.viplinks.org
app.use(cors({
  origin: ['https://app.viplinks.org', 'http://localhost:3000'],
  credentials: true
}));

app.use(express.json());

// Supabase
const supabaseAnon = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
const supabaseUrl = process.env.SUPABASE_URL;
const supabase = createClient(supabaseUrl, supabaseAnon, {
  auth: { persistSession: false, autoRefreshToken: false }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString() 
  });
});

// Registro
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, username } = req.body;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          username: username || email.split('@')[0],
          plan: 'free'
        }
      }
    });
    if (error) throw error;
    res.json({ success: true, user: data.user });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    res.json({
      success: true,
      user: data.user,
      session: data.session
    });
  } catch (error) {
    res.status(401).json({ success: false, error: error.message });
  }
});

// Obtener usuario actual
app.get('/api/auth/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) throw new Error('No token provided');
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error) throw error;
    res.json({ success: true, user });
  } catch (error) {
    res.status(401).json({ success: false, error: error.message });
  }
});

// Logout
app.post('/api/auth/logout', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const { error } = await supabase.auth.signOut(token);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Helper function para obtener usuario autenticado y su profile
async function getAuthenticatedUser(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) throw new Error('No token provided');
  
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error) throw error;
  
  // Obtener el profile_id desde la tabla profiles
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .single();
    
  if (profileError) throw new Error('Profile not found');
  
  return { user, profile_id: profile.id };
}

// ================= PRODUCTOS ================= 

// GET /api/products - Obtener productos del usuario
app.get('/api/products', async (req, res) => {
  try {
    const { profile_id } = await getAuthenticatedUser(req);
    
    const { data: products, error } = await supabase
      .from('products')
      .select('*')
      .eq('seller_id', profile_id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Adaptar estructura para el frontend
    const adaptedProducts = products.map(product => ({
      id: product.id,
      name: product.name,
      description: product.description,
      price: parseFloat(product.price || 0),
      category: product.type, // tu DB usa 'type', frontend espera 'category'
      status: product.status,
      deliveryMethod: product.delivery_method,
      hasGuarantee: false, // tu tabla no tiene este campo aún
      created_at: product.created_at,
      image_url: product.image_url,
      views: product.views || 0
    }));

    res.json({
      success: true,
      products: adaptedProducts
    });
  } catch (error) {
    res.status(401).json({ success: false, error: error.message });
  }
});

// POST /api/products - Crear nuevo producto
app.post('/api/products', async (req, res) => {
  try {
    const { profile_id } = await getAuthenticatedUser(req);
    
    // Adaptar datos del frontend a tu estructura DB
    const productData = {
      seller_id: profile_id,
      name: req.body.name,
      description: req.body.description,
      price: req.body.price,
      type: req.body.category, // frontend envía 'category', DB espera 'type'
      category: req.body.category,
      delivery_method: req.body.deliveryMethod || 'email',
      delivery_config: req.body.deliveryConfig || {},
      image_url: req.body.image_url,
      status: 'active'
    };

    const { data: product, error } = await supabase
      .from('products')
      .insert([productData])
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      product
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// PUT /api/products/:id - Actualizar producto
app.put('/api/products/:id', async (req, res) => {
  try {
    const { profile_id } = await getAuthenticatedUser(req);
    const productId = req.params.id;

    // Adaptar datos del frontend
    const updateData = {
      ...req.body,
      updated_at: new Date().toISOString()
    };
    
    // Cambiar 'category' a 'type' si viene del frontend
    if (updateData.category) {
      updateData.type = updateData.category;
    }

    const { data: product, error } = await supabase
      .from('products')
      .update(updateData)
      .eq('id', productId)
      .eq('seller_id', profile_id)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      product
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// DELETE /api/products/:id - Eliminar producto  
app.delete('/api/products/:id', async (req, res) => {
  try {
    const { profile_id } = await getAuthenticatedUser(req);
    const productId = req.params.id;

    const { error } = await supabase
      .from('products')
      .delete()
      .eq('id', productId)
      .eq('seller_id', profile_id);

    if (error) throw error;

    res.json({
      success: true,
      message: 'Product deleted successfully'
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// ================= ESTADÍSTICAS ================= 

// GET /api/stats - Obtener estadísticas del usuario
app.get('/api/stats', async (req, res) => {
  try {
    const { profile_id } = await getAuthenticatedUser(req);

    // Obtener productos del usuario
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('*')
      .eq('seller_id', profile_id);

    if (productsError) throw productsError;

    // Obtener ventas del usuario - usando tu estructura real
    const { data: sales, error: salesError } = await supabase
      .from('sales')
      .select('*')
      .eq('seller_id', profile_id);

    if (salesError) throw salesError;

    // Calcular estadísticas basadas en tu estructura real de sales
    const completedSales = (sales || []).filter(sale => sale.status === 'completed');
    const pendingSales = (sales || []).filter(sale => sale.status === 'pending');
    const totalSales = completedSales.reduce((sum, sale) => sum + parseFloat(sale.amount || 0), 0);
    const totalCommissions = completedSales.reduce((sum, sale) => sum + parseFloat(sale.commission || 0), 0);
    const totalEarnings = completedSales.reduce((sum, sale) => sum + parseFloat(sale.seller_amount || 0), 0);

    // Contar productos por tipo
    const gamingProducts = products.filter(p => p.type === 'gaming').length;
    const generalProducts = products.filter(p => p.type === 'general').length;
    const invitationProducts = products.filter(p => p.type === 'invitation').length;
    const cardProducts = products.filter(p => p.type === 'card').length;

    // Calcular comisiones promedio por tipo (basado en ventas reales)
    const gamingSales = completedSales.filter(sale => {
      const product = products.find(p => p.id === sale.product_id);
      return product && product.type === 'gaming';
    });
    const generalSales = completedSales.filter(sale => {
      const product = products.find(p => p.id === sale.product_id);
      return product && product.type === 'general';
    });

    const gamingCommission = gamingSales.length > 0 ? 
      (gamingSales.reduce((sum, sale) => sum + parseFloat(sale.commission || 0), 0) / gamingSales.reduce((sum, sale) => sum + parseFloat(sale.amount || 0), 0)) * 100 : 1.3;
    
    const productsCommission = generalSales.length > 0 ?
      (generalSales.reduce((sum, sale) => sum + parseFloat(sale.commission || 0), 0) / generalSales.reduce((sum, sale) => sum + parseFloat(sale.amount || 0), 0)) * 100 : 7.0;

    const gamingEarnings = gamingSales.reduce((sum, sale) => sum + parseFloat(sale.seller_amount || 0), 0);
    const productsEarnings = generalSales.reduce((sum, sale) => sum + parseFloat(sale.seller_amount || 0), 0);

    // Garantías activas (ventas completadas en los últimos 7 días que podrían tener garantía)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const activeGuarantees = completedSales.filter(sale => 
      new Date(sale.created_at) > sevenDaysAgo
    ).length;
    
    const pendingReleases = pendingSales.reduce((sum, sale) => sum + parseFloat(sale.seller_amount || 0), 0);

    // Crecimiento de ventas (comparar con mes anterior)
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    
    const currentMonthSales = completedSales.filter(sale => new Date(sale.created_at) > oneMonthAgo);
    const salesGrowth = currentMonthSales.length > 0 && completedSales.length > currentMonthSales.length ? 
      ((currentMonthSales.length / (completedSales.length - currentMonthSales.length)) * 100).toFixed(1) : 0;

    const stats = {
      totalSales,
      totalCommissions,
      totalEarnings,
      gamingCommission: parseFloat(gamingCommission.toFixed(1)),
      productsCommission: parseFloat(productsCommission.toFixed(1)),
      gamingEarnings,
      productsEarnings,
      activeGuarantees,
      pendingReleases,
      invitationSales: invitationProducts,
      salesGrowth: parseFloat(salesGrowth),
      productsCount: products.length,
      gamingProductsCount: gamingProducts,
      generalProductsCount: generalProducts,
      invitationProductsCount: invitationProducts,
      cardProductsCount: cardProducts,
      totalViews: products.reduce((sum, p) => sum + (p.views || 0), 0),
      totalSalesCount: completedSales.length,
      pendingSalesCount: pendingSales.length
    };

    res.json({
      success: true,
      stats
    });
  } catch (error) {
    res.status(401).json({ success: false, error: error.message });
  }
});

// ================= OPCIONAL: ENDPOINT PARA CREAR VENTA ================= 

// POST /api/sales - Registrar nueva venta (cuando Mercado Pago confirme pago)
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

    const { data: sale, error } = await supabase
      .from('sales')
      .insert([saleData])
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      sale
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});
app.listen(PORT, () => {
  console.log(`VipLinks API running on port ${PORT}`);
});

