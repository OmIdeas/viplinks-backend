// routes/products.js
import express from 'express';
import { supabaseAdmin } from '../supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { encrypt } from '../utils/encryption.js';
import { validatePlayer } from '../utils/rcon.js';

const router = express.Router();

// GET /api/products - Listar productos del usuario
router.get('/', requireAuth, async (req, res) => {
  try {
    const { data: products, error } = await supabaseAdmin
      .from('products')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({ success: true, products });
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/products - Crear producto con RCON
router.post('/', requireAuth, async (req, res) => {
  try {
    // ==========================================
    // 🔍 LOGS DE DIAGNÓSTICO - INICIO
    // ==========================================
    console.log('📦 === DATOS RECIBIDOS EN BACKEND ===');
    console.log('📋 Body completo:', JSON.stringify(req.body, null, 2));
    console.log('🎮 rconHost:', req.body.rconHost);
    console.log('🔌 rconPort:', req.body.rconPort);
    console.log('🔑 rconPassword:', req.body.rconPassword ? '***EXISTE***' : 'undefined/null');
    console.log('⚙️ commands:', req.body.commands);
    console.log('📦 =====================================');
    // ==========================================
    // 🔍 LOGS DE DIAGNÓSTICO - FIN
    // ==========================================

    const {
      name, description, price, currency, type, category, duration,
      image, status,
      // RCON
      rconHost,
      rconPort,
      rconPassword,
      commands
    } = req.body;

    console.log('📦 Después de destructuring:');
    console.log('🎮 rconHost:', rconHost);
    console.log('🔌 rconPort:', rconPort);
    console.log('🔑 rconPassword:', rconPassword ? '***EXISTE***' : 'undefined/null');

    let encryptedPassword = null;

    // Si tiene config RCON, probar conexión
    if (rconHost && rconPort && rconPassword) {
      console.log('✅ Tiene credenciales RCON, probando conexión...');
      
      try {
        const testConfig = {
          ip: rconHost,
          port: parseInt(rconPort),
          password: rconPassword
        };

        console.log('🧪 Test config:', { ip: testConfig.ip, port: testConfig.port, password: '***' });

        // Test de conexión
        const testResult = await validatePlayer(testConfig, 'test_connection');
        
        // Si hay error de conexión (no de jugador no encontrado)
        if (testResult.error && testResult.error.includes('conectar')) {
          return res.status(400).json({
            success: false,
            error: 'RCON connection failed: ' + testResult.message
          });
        }

        console.log('✅ RCON test exitoso');
        
        // Encriptar password
        encryptedPassword = JSON.stringify(encrypt(rconPassword));

      } catch (testError) {
        console.error('❌ RCON test error:', testError);
        return res.status(400).json({
          success: false,
          error: 'RCON test failed: ' + testError.message
        });
      }
    } else {
      console.log('⚠️ NO tiene credenciales RCON completas');
      console.log('   rconHost:', rconHost);
      console.log('   rconPort:', rconPort);
      console.log('   rconPassword:', rconPassword ? 'existe' : 'NO existe');
    }

    console.log('💾 Guardando producto con:');
    console.log('   rcon_host:', rconHost || null);
    console.log('   rcon_port:', rconPort ? parseInt(rconPort) : null);
    console.log('   rcon_password:', encryptedPassword ? 'ENCRIPTADO' : null);
    console.log('   commands:', commands || []);

    // Crear producto
    const { data: product, error } = await supabaseAdmin
      .from('products')
      .insert({
        user_id: req.user.id,
        name,
        description,
        price: parseFloat(price),
        currency: currency || 'USD',
        type: type || 'vip',
        category: category || 'gaming',
        duration: duration || 'permanent',
        image_url: image,
        status: status || 'active',
        rcon_host: rconHost || null,
        rcon_port: rconPort ? parseInt(rconPort) : null,
        rcon_password: encryptedPassword,
        commands: commands || []
      })
      .select()
      .single();

    if (error) throw error;

    console.log('✅ Producto creado exitosamente:', product.id);

    res.json({
      success: true,
      product,
      public_url: `${process.env.FRONTEND_URL}/buy/${product.id}`,
      short_url: `${process.env.FRONTEND_URL}/p/${product.id.split('-')[0]}`
    });

  } catch (error) {
    console.error('❌ Error creating product:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/products/:id - Obtener producto específico
router.get('/:id', async (req, res) => {
  try {
    const { data: product, error } = await supabaseAdmin
      .from('products')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) throw error;

    res.json({ success: true, product });
  } catch (error) {
    console.error('Error fetching product:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/products/:id - Actualizar producto
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { data: product, error } = await supabaseAdmin
      .from('products')
      .update(req.body)
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, product });
  } catch (error) {
    console.error('Error updating product:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/products/:id - Eliminar producto
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { error } = await supabaseAdmin
      .from('products')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);

    if (error) throw error;

    res.json({ success: true, message: 'Product deleted' });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
