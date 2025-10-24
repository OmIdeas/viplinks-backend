import express from 'express';
import { supabaseAdmin } from '../supabase.js';
import { decrypt } from '../utils/encryption.js';
import { executeDeliveryCommands } from '../utils/rcon.js';

const router = express.Router();

router.post('/mercadopago', async (req, res) => {
  try {
    const { type, data } = req.body;
    
    if (type !== 'payment') {
      return res.sendStatus(200);
    }

    // Buscar compra por payment_id
    const { data: purchase, error: purchaseError } = await supabaseAdmin
      .from('sales')
      .select('*')
      .eq('payment_id', String(data.id))
      .single();

    if (purchaseError || !purchase) {
      console.log('Compra no encontrada para payment:', data.id);
      return res.sendStatus(200);
    }

    // Si ya fue entregado, skip
    if (purchase.kit_delivered) {
      return res.sendStatus(200);
    }

    // Obtener producto con config RCON
    const { data: product, error: productError } = await supabaseAdmin
      .from('products')
      .select('*')
      .eq('id', purchase.product_id)
      .single();

    if (productError || !product) {
      console.error('Producto no encontrado');
      return res.sendStatus(404);
    }

    // Verificar que tenga RCON configurado
    if (!product.rcon_host || !product.rcon_password || !product.commands) {
      console.log('Producto sin RCON configurado');
      return res.sendStatus(200);
    }

    // Desencriptar password
    const encryptedObj = JSON.parse(product.rcon_password);
    const password = decrypt(encryptedObj);

    // Config RCON
    const rconConfig = {
      ip: product.rcon_host,
      port: product.rcon_port,
      password: password
    };

    // Variables para reemplazar en comandos
    const variables = {
      steamid: purchase.buyer_steam_id || 'UNKNOWN',
      username: purchase.buyer_username || 'UNKNOWN',
      email: purchase.buyer_email,
      orderid: purchase.id
    };

    // Ejecutar comandos
    // Intentar entrega inmediata
let deliverySuccess = false;
let deliveryError = null;

console.log('🎮 Intentando entrega inmediata...');

try {
  const result = await executeDeliveryCommands(
    rconConfig,
    product.commands,
    variables
  );
  
  if (result.success) {
    console.log('✅ Entrega inmediata exitosa');
    deliverySuccess = true;
    
    // Actualizar venta como completada
    await supabaseAdmin
      .from('sales')
      .update({
        status: 'completed',
        kit_delivered: true,
        delivery_status: 'completed',
        delivered_at: new Date().toISOString()
      })
      .eq('id', purchase.id);
    
    console.log(`✅ Kit entregado: ${product.name} → ${purchase.buyer_email}`);
  } else {
    deliveryError = result.message || result.error || 'Error en entrega';
    console.log('⚠️ Entrega inmediata falló:', deliveryError);
  }
} catch (error) {
  deliveryError = error.message;
  console.error('❌ Error en entrega inmediata:', error);
}

// Si la entrega falló, guardar en pending_deliveries para reintentos
if (!deliverySuccess) {
  console.log('💾 Guardando en pending_deliveries para reintentos automáticos...');
  
  try {
    const { error: pendingError } = await supabaseAdmin
      .from('pending_deliveries')
      .insert({
        sale_id: purchase.id,
        product_id: product.id,
        seller_id: product.seller_id,
        steam_id: purchase.buyer_steam_id || 'UNKNOWN',
        commands: product.commands || [],
        server_config: {
          ip: product.rcon_host,
          port: product.rcon_port,
          password: password // Ya desencriptado
        },
        status: 'pending',
        attempts: 0,
        error_message: deliveryError,
        expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString() // 6 horas
      });
    
    if (pendingError) {
      console.error('❌ Error guardando pending_delivery:', pendingError);
      
      // Marcar venta como fallida si no se pudo guardar para reintentos
      await supabaseAdmin
        .from('sales')
        .update({
          status: 'failed',
          delivery_status: 'failed',
          error_message: `No se pudo entregar ni guardar para reintentos: ${deliveryError}`
        })
        .eq('id', purchase.id);
    } else {
      console.log('✅ Entrega guardada para reintentos automáticos (máximo 6 horas)');
      
      // Actualizar venta como "pending delivery"
      await supabaseAdmin
        .from('sales')
        .update({
          status: 'pending',
          delivery_status: 'pending',
          notes: 'Entrega automática en proceso. El sistema reintentará cuando el jugador se conecte (máximo 6 horas).'
        })
        .eq('id', purchase.id);
    }
  } catch (error) {
    console.error('❌ Error crítico en pending_deliveries:', error);
    
    // Marcar como fallida
    await supabaseAdmin
      .from('sales')
      .update({
        status: 'failed',
        delivery_status: 'failed',
        error_message: error.message
      })
      .eq('id', purchase.id);
  }
}

// ============================================
// SISTEMA DE REINTENTOS - FIN
// ============================================

res.sendStatus(200);
  } catch (error) {
    console.error('Webhook error:', error);
    res.sendStatus(500);
  }
});

export default router;
