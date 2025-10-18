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
    const result = await executeDeliveryCommands(
      rconConfig,
      product.commands,
      variables
    );

    // Actualizar compra
    if (result.success) {
      await supabaseAdmin
        .from('sales')
        .update({
          status: 'completed',
          kit_delivered: true,
          delivered_at: new Date().toISOString()
        })
        .eq('id', purchase.id);

      console.log(`✅ Kit entregado: ${product.name} → ${purchase.buyer_email}`);
    } else {
      await supabaseAdmin
        .from('sales')
        .update({
          status: 'failed',
          error_message: result.error || 'Error ejecutando comandos'
        })
        .eq('id', purchase.id);

      console.error(`❌ Error entregando: ${result.error}`);
    }

    res.sendStatus(200);

  } catch (error) {
    console.error('Webhook error:', error);
    res.sendStatus(500);
  }
});

export default router;
