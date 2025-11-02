// routes/products.js
import express from 'express';
import jwt from 'jsonwebtoken';
import { supabaseAdmin } from '../supabase.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

// ------------------------------
// Helper: Obtener usuario autenticado
// ------------------------------
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
    commissionRate = 0.013; // 1.3% para productos gaming
  } else {
    commissionRate = 0.07; // 7% para productos generales
    if (product.has_guarantee) {
      commissionRate += 0.02; // +2% si tiene garantía
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
// GET /api/products - Listar productos del usuario
// ------------------------------
router.get('/', async (req, res) => {
  try {
    console.log('🔍 GET /api/products - Listando productos');
    
    const { profile_id } = await getAuthenticatedUser(req);
    
    const { data: products, error } = await supabaseAdmin
      .from('products')
      .select('*')
      .eq('seller_id', profile_id)
      .order('created_at', { ascending: false });
      
    if (error) throw error;

    // Adaptar productos al formato esperado por el frontend
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
      views: product.views || 0,
      sales_count: product.sales_count || 0
    }));

    console.log(`✅ Retornando ${adaptedProducts.length} productos`);
    res.json({ success: true, products: adaptedProducts });
    
  } catch (error) {
    console.error('❌ Error fetching products:', error.message);
    res.status(401).json({ success: false, error: error.message });
  }
});

// ------------------------------
// POST /api/products - Crear nuevo producto (gaming o general)
// ------------------------------
router.post('/', async (req, res) => {
  try {
    console.log('🚀 POST /api/products - Creando producto');
    console.log('📋 Body recibido:', JSON.stringify(req.body, null, 2));
    
    const { profile_id } = await getAuthenticatedUser(req);
    console.log('👤 User profile_id:', profile_id);

    // Determinar tipo de producto
    const category = req.body.category || 'gaming';
    const isGaming = category === 'gaming';

    console.log(`🎯 Tipo de producto: ${category} (${isGaming ? 'GAMING' : 'GENERAL'})`);

    // Construir datos del producto
    const productData = {
      seller_id: profile_id,
      name: req.body.name,
      description: req.body.description,
      price: parseFloat(req.body.price),
      currency: req.body.currency || 'USD',
      type: category,
      category: category,
      delivery_method: req.body.delivery_method || (isGaming ? 'rcon' : 'manual'),
      image_url: req.body.image || null,
      status: req.body.status || 'active',
      product_type: req.body.type,
      payment_methods: req.body.payment_methods || null,
      visibility: 'private',
      views: 0,
      sales_count: 0,
      requires_inventory: req.body.requires_inventory || false,
    };

    // Campos específicos para productos GAMING
    if (isGaming) {
      console.log('🎮 Configurando producto GAMING');
      
      // ✅ AGREGADO: Guardar server_key
      if (req.body.server_key) {
        productData.server_key = req.body.server_key;
        console.log('   ✅ server_key:', req.body.server_key);
      }
      
      // El frontend envía rconHost, rconPort, rconPassword
      // Construir server_config a partir de estos campos
      if (req.body.rconHost && req.body.rconPort && req.body.rconPassword) {
        productData.server_config = {
          ip: req.body.rconHost,
          rcon_port: parseInt(req.body.rconPort),
          rcon_password: req.body.rconPassword
        };
        console.log('   ✅ Server config:', { 
          ip: req.body.rconHost, 
          rcon_port: req.body.rconPort, 
          rcon_password: '***' 
        });
      } else if (req.body.server) {
        // Soporte para formato alternativo (server object directo)
        productData.server_config = req.body.server;
        console.log('   ✅ Server config (legacy):', req.body.server);
      } else {
        productData.server_config = null;
        console.log('   ⚠️ NO se proporcionó server config');
      }
      
      // ✅ CORREGIDO: Usar delivery_commands (no commands)
      productData.delivery_commands = req.body.delivery_commands || req.body.commands || null;
      
      if (productData.delivery_commands) {
        console.log('   ✅ Delivery Commands:', productData.delivery_commands);
      }
    }

    // Campos específicos para productos GENERALES
    if (!isGaming) {
      console.log('📦 Configurando producto GENERAL');
      productData.has_guarantee = req.body.has_guarantee === true;
      productData.warranty_extra_days = req.body.warranty_extra_days || 0;
      productData.warranty_note = req.body.warranty_note || null;
      productData.brand_name = req.body.brand_name || null;
      productData.brand_logo = req.body.brand_logo || null;
      productData.background_image = req.body.background_image || null;
      productData.brand_colors = req.body.brand_colors || null;
      
      // Información de contacto
      productData.contact_email = req.body.contact_email || false;
      productData.contact_phone = req.body.contact_phone || false;
      productData.contact_whatsapp = req.body.contact_whatsapp || false;
      
      console.log('   ✅ Has guarantee:', productData.has_guarantee);
      if (productData.has_guarantee) {
        console.log('   ✅ Warranty days:', productData.warranty_extra_days);
      }
      console.log('   ✅ Contact methods:', {
        email: productData.contact_email,
        phone: productData.contact_phone,
        whatsapp: productData.contact_whatsapp
      });
      if (productData.brand_name) {
        console.log('   ✅ Brand name:', productData.brand_name);
      }
    }

    // Calcular comisiones
    const fees = calculateCommission(productData);
    console.log('💰 Comisiones calculadas:', fees);

    // Insertar producto en la base de datos
    const { data: product, error } = await supabaseAdmin
      .from('products')
      .insert([productData])
      .select()
      .single();

    if (error) {
      console.error('❌ Supabase error:', error);
      throw error;
    }

    console.log('✅ Producto creado exitosamente:', product.id);
    
    const publicUrl = `https://viplinks.org/app/buy.html?id=${product.id}`;
    
    res.json({ 
      success: true, 
      product,
      public_url: publicUrl,
      url: publicUrl,
      slug: product.id,
      id: product.id,
      fees
    });

  } catch (error) {
    console.error('❌ Error creating product:', error.message);
    res.status(400).json({ success: false, error: error.message });
  }
});

// ------------------------------
// PUT /api/products/:id - Actualizar producto
// ------------------------------
router.put('/:id', async (req, res) => {
  try {
    console.log(`🔄 PUT /api/products/${req.params.id} - Actualizando producto`);
    
    const { profile_id } = await getAuthenticatedUser(req);
    const productId = req.params.id;

    const updateData = { ...req.body, updated_at: new Date().toISOString() };
    if (updateData.category) updateData.type = updateData.category;

    console.log('📝 Datos de actualización:', updateData);

    const { data: product, error } = await supabaseAdmin
      .from('products')
      .update(updateData)
      .eq('id', productId)
      .eq('seller_id', profile_id)
      .select()
      .single();

    if (error) throw error;

    console.log('✅ Producto actualizado exitosamente');
    res.json({ success: true, product });
    
  } catch (error) {
    console.error('❌ Error updating product:', error.message);
    res.status(400).json({ success: false, error: error.message });
  }
});

// ------------------------------
// DELETE /api/products/:id - Eliminar producto
// ------------------------------
router.delete('/:id', async (req, res) => {
  try {
    console.log(`🗑️ DELETE /api/products/${req.params.id} - Eliminando producto`);
    
    const { profile_id } = await getAuthenticatedUser(req);
    const productId = req.params.id;

    const { error } = await supabaseAdmin
      .from('products')
      .delete()
      .eq('id', productId)
      .eq('seller_id', profile_id);

    if (error) throw error;

    console.log('✅ Producto eliminado exitosamente');
    res.json({ success: true, message: 'Product deleted successfully' });
    
  } catch (error) {
    console.error('❌ Error deleting product:', error.message);
    res.status(400).json({ success: false, error: error.message });
  }
});

export default router;
