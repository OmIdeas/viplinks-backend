// routes/webhooks.js - VERSIÓN PLUGIN-ONLY (sin RCON del backend)
import express from 'express';
import { supabaseAdmin } from '../supabase.js';

const router = express.Router();

/**
 * Webhook de Mercado Pago
 * POST /api/webhooks/mercadopago
 */
router.post('/mercadopago', async (req, res) => {
  try {
    console.log('🔔 Webhook Mercado Pago recibido');
    console.log('Body:', JSON.stringify(req.body, null, 2));

    const { type, data } = req.body;

    // Solo procesar pagos aprobados
    if (type !== 'payment') {
      console.log('⏭️ Evento ignorado (no es payment):', type);
      return res.status(200).json({ received: true });
    }

    const paymentId = data?.id;
    if (!paymentId) {
      console.log('❌ No se encontró payment ID');
      return res.status(400).json({ error: 'No payment ID' });
    }

    console.log('💳 Payment ID:', paymentId);

    // Buscar la venta asociada
    const { data: sale, error: saleError } = await supabaseAdmin
      .from('sales')
      .select('*')
      .eq('payment_id', paymentId)
      .eq('status', 'pending')
      .maybeSingle();

    if (saleError) {
      console.error('❌ Error buscando venta:', saleError);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!sale) {
      console.log('ℹ️ Venta no encontrada o ya procesada:', paymentId);
      return res.status(200).json({ received: true, message: 'Sale not found or already processed' });
    }

    console.log('📦 Venta encontrada:', sale.id);

    // Obtener el producto
    const { data: product, error: productError } = await supabaseAdmin
      .from('products')
      .select('*')
      .eq('id', sale.product_id)
      .single();

    if (productError || !product) {
      console.error('❌ Producto no encontrado:', productError);
      return res.status(500).json({ error: 'Product not found' });
    }

    console.log('✅ Producto obtenido:', product.name);

    // Actualizar venta a completada (pago aprobado)
    await supabaseAdmin
      .from('sales')
      .update({
        status: 'completed',
        updated_at: new Date().toISOString()
      })
      .eq('id', sale.id);

    console.log('✅ Pago confirmado, venta actualizada');

    // PROCESAR ENTREGA GAMING - SOLO CREAR PENDING_DELIVERY
    const isGaming = product.type === 'gaming' || product.category === 'gaming';
    
    if (isGaming && product.server_config && product.delivery_commands?.length > 0) {
      console.log('🎮 Producto gaming detectado - Creando pending_delivery para el plugin...');

      const serverConfig = product.server_config;
      const steam_id = sale.buyer_steam_id;
      const buyer_username = sale.buyer_username || steam_id;

      // ✅ SOLO CREAR pending_delivery - El plugin lo procesará
      const { error: pendingError } = await supabaseAdmin
        .from('pending_deliveries')
        .insert({
          sale_id: sale.id,
          server_key: serverConfig.server_key || 'default',
          steam_id: steam_id,
          username: buyer_username,
          product_name: product.name,
          commands: product.delivery_commands,
          server_config: {
            ip: serverConfig.ip,
            rcon_port: serverConfig.rcon_port || serverConfig.port,
            rcon_password: serverConfig.rcon_password || serverConfig.password
          },
          requires_inventory: product.requires_inventory || false, // ← COPIAR DESDE PRODUCTO
          status: 'pending',
          attempts: 0,
          created_at: new Date().toISOString()
        });

      if (pendingError) {
        console.error('❌ Error creando pending_delivery:', pendingError);
        throw pendingError;
      }

      console.log('✅ Pending delivery creada - El plugin la procesará en máximo 3 minutos');

      // Marcar venta como pending (esperando entrega del plugin)
      await supabaseAdmin
        .from('sales')
        .update({
          delivery_status: 'pending',
          notes: 'Entrega delegada al plugin del servidor'
        })
        .eq('id', sale.id);

    } else if (isGaming) {
      console.log('⚠️ Producto gaming sin configuración RCON o comandos');
      
      await supabaseAdmin
        .from('sales')
        .update({
          delivery_status: 'completed',
          notes: 'Producto sin entrega automática configurada'
        })
        .eq('id', sale.id);

    } else {
      console.log('📦 Producto no-gaming, entrega manual');
      
      await supabaseAdmin
        .from('sales')
        .update({
          delivery_status: 'completed',
          notes: 'Producto no requiere entrega automática'
        })
        .eq('id', sale.id);
    }

    console.log('✅ Webhook procesado exitosamente');
    return res.status(200).json({ 
      received: true, 
      processed: true,
      sale_id: sale.id 
    });

  } catch (error) {
    console.error('❌ Error procesando webhook:', error);
    return res.status(500).json({ 
      error: 'Webhook processing failed',
      message: error.message 
    });
  }
});

/**
 * Health check para webhooks
 */
router.get('/health', (req, res) => {
  res.json({ ok: true, service: 'webhooks' });
});

export default router;
