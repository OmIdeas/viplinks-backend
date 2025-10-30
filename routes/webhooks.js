
// routes/webhooks.js - VERSIÓN CORREGIDA
import express from 'express';
import { supabaseAdmin } from '../supabase.js';
import { executeDeliveryCommands } from '../utils/rcon.js';

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
    console.log('🔍 Product details:', {
      id: product.id,
      name: product.name,
      type: product.type,
      category: product.category,
      has_server_config: !!product.server_config,
      has_delivery_commands: !!product.delivery_commands,
      commands_count: product.delivery_commands?.length || 0
    });

    // Actualizar venta a completada (pago aprobado)
    await supabaseAdmin
      .from('sales')
      .update({
        status: 'completed',
        updated_at: new Date().toISOString()
      })
      .eq('id', sale.id);

    console.log('✅ Pago confirmado, venta actualizada');

    // PROCESAR ENTREGA GAMING
    const isGaming = product.type === 'gaming' || product.category === 'gaming';
    
    if (isGaming && product.server_config && product.delivery_commands?.length > 0) {
      console.log('🎮 Iniciando proceso de entrega gaming...');

      try {
        // ✅ EXTRACCIÓN CORRECTA DE server_config
        const serverConfig = product.server_config;
        const rconConfig = {
          ip: serverConfig.ip,
          port: parseInt(serverConfig.rcon_port || serverConfig.port, 10),
          password: serverConfig.rcon_password || serverConfig.password
        };

        console.log('🔍 RCON Config extraído:', {
          ip: rconConfig.ip,
          port: rconConfig.port,
          hasPassword: !!rconConfig.password
        });

        // ✅ VALIDACIÓN CRÍTICA
        if (!rconConfig.ip || !rconConfig.port || !rconConfig.password) {
          throw new Error('Configuración RCON incompleta: ' + JSON.stringify({
            hasIp: !!rconConfig.ip,
            hasPort: !!rconConfig.port,
            hasPassword: !!rconConfig.password
          }));
        }

        const steam_id = sale.buyer_steam_id;
        const buyer_username = sale.buyer_username || steam_id;
        const buyer_email = sale.buyer_email || '';

        const buyer_info = {
          steamid: steam_id,
          username: buyer_username,
          email: buyer_email,
          orderid: sale.id,
          player: steam_id
        };

        console.log('👤 Buyer info:', {
          steamid: buyer_info.steamid,
          username: buyer_info.username,
          email: buyer_info.email ? 'SET' : 'EMPTY'
        });

        console.log('🚀 Ejecutando comandos RCON...');
        console.log('📋 Comandos:', product.delivery_commands);

        // ✅ EJECUTAR CON SISTEMA DE REINTENTOS AUTOMÁTICOS (3 intentos)
        const deliveryResult = await executeDeliveryCommands(
          rconConfig,
          product.delivery_commands,
          buyer_info
        );

        console.log('📊 Resultado de entrega:', {
          success: deliveryResult.success,
          successCount: deliveryResult.successCount,
          failedCount: deliveryResult.failedCount,
          error: deliveryResult.error || 'none'
        });

        if (deliveryResult.success) {
          console.log('✅ Entrega RCON exitosa');

          // Actualizar venta como entregada
          await supabaseAdmin
            .from('sales')
            .update({
              delivery_status: 'completed',
              kit_delivered: true,
              delivered_at: new Date().toISOString()
            })
            .eq('id', sale.id);

          console.log('✅ Venta marcada como entregada');

        } else {
          console.log('⚠️ Entrega RCON falló, creando pending_delivery para reintentos');

          // Crear pending_delivery para que el cron worker lo reintente
          await supabaseAdmin
            .from('pending_deliveries')
            .insert({
              sale_id: sale.id,
              server_key: serverConfig.server_key || 'unknown',
              steam_id: steam_id,
              username: buyer_username,
              product_name: product.name,
              commands: Array.isArray(product.delivery_commands) ? product.delivery_commands : [product.delivery_commands],
              server_config: rconConfig,
              status: 'pending',
              attempts: 0,
              error_message: deliveryResult.error || deliveryResult.message || 'Error inicial de entrega'
            });

          console.log('✅ Pending delivery creada - El cron worker la procesará');

          // Marcar como pending (no failed) para que el sistema lo reintente
          await supabaseAdmin
            .from('sales')
            .update({
              delivery_status: 'pending',
              notes: 'Entrega en cola - se reintentará automáticamente'
            })
            .eq('id', sale.id);
        }

      } catch (rconError) {
        console.error('❌ Error en proceso de entrega RCON:', rconError);

        // Crear pending_delivery de emergencia
        try {
          const steam_id = sale.buyer_steam_id;
          const buyer_username = sale.buyer_username || steam_id;

          await supabaseAdmin
            .from('pending_deliveries')
            .insert({
              sale_id: sale.id,
              server_key: 'unknown',
              steam_id: steam_id,
              username: buyer_username,
              product_name: product.name,
              commands: product.delivery_commands || [],
              server_config: product.server_config,
              status: 'pending',
              attempts: 0,
              error_message: rconError.message
            });

          console.log('✅ Pending delivery de emergencia creada');
        } catch (insertError) {
          console.error('❌ Error crítico creando pending_delivery:', insertError);
        }

        // NO marcar como failed, dejar en pending
        await supabaseAdmin
          .from('sales')
          .update({
            delivery_status: 'pending',
            notes: `Error inicial: ${rconError.message} - Se reintentará`
          })
          .eq('id', sale.id);
      }

    } else if (isGaming) {
      console.log('⚠️ Producto gaming sin configuración RCON o comandos');
      
      // Marcar como completada si no requiere entrega automática
      await supabaseAdmin
        .from('sales')
        .update({
          delivery_status: 'completed',
          notes: 'Producto sin entrega automática configurada'
        })
        .eq('id', sale.id);

    } else {
      console.log('📦 Producto no-gaming, entrega manual');
      
      // Productos no-gaming se marcan como completados
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
