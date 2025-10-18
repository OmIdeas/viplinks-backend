import { encrypt } from '../utils/encryption.js';
import { validatePlayer, executeDeliveryCommands } from '../utils/rcon.js';

// POST /api/products - Crear producto con RCON
router.post('/', requireAuth, async (req, res) => {
  try {
    const {
      name, description, price, currency, type, category, duration,
      image, status,
      // RCON
      rconHost,
      rconPort,
      rconPassword,
      commands
    } = req.body;

    let encryptedPassword = null;

    // Si tiene config RCON, probar conexión
    if (rconHost && rconPort && rconPassword) {
      try {
        // Probar conexión básica ejecutando 'status'
        const { validatePlayer } = await import('../utils/rcon.js');
        
        // Test básico de conexión (no valida jugador, solo conecta)
        const testConfig = {
          ip: rconHost,
          port: parseInt(rconPort),
          password: rconPassword
        };

        // Usar validatePlayer con un ID dummy solo para probar conexión
        const testResult = await validatePlayer(testConfig, 'test');
        
        // Si hay error de conexión (no de jugador no encontrado), fallar
        if (testResult.error && testResult.error.includes('conectar')) {
          return res.status(400).json({
            success: false,
            error: 'RCON connection failed: ' + testResult.message
          });
        }

        // Encriptar password
        encryptedPassword = JSON.stringify(encrypt(rconPassword));

      } catch (testError) {
        return res.status(400).json({
          success: false,
          error: 'RCON test failed: ' + testError.message
        });
      }
    }

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

    res.json({
      success: true,
      product,
      public_url: `${process.env.FRONTEND_URL}/buy/${product.id}`
    });

  } catch (error) {
    console.error('Error creating product:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});
