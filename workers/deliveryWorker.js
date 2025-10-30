// workers/deliveryWorker.js - NUEVO ARCHIVO
import { supabaseAdmin } from '../supabase.js';
import { executeDeliveryCommands } from '../utils/rcon.js';

/**
 * Procesa entregas pendientes cada minuto
 */
export async function processePendingDeliveries() {
  try {
    console.log('🔄 [WORKER] Procesando entregas pendientes...');

    // Obtener entregas pendientes (máximo 5 intentos)
    const { data: pendingDeliveries, error } = await supabaseAdmin
      .from('pending_deliveries')
      .select('*')
      .eq('status', 'pending')
      .lt('attempts', 5)
      .order('created_at', { ascending: true })
      .limit(20);

    if (error) {
      console.error('❌ [WORKER] Error obteniendo pending deliveries:', error);
      return;
    }

    if (!pendingDeliveries || pendingDeliveries.length === 0) {
      console.log('✅ [WORKER] No hay entregas pendientes');
      return;
    }

    console.log(`📦 [WORKER] ${pendingDeliveries.length} entregas pendientes`);

    // Procesar cada entrega
    for (const delivery of pendingDeliveries) {
      await processSingleDelivery(delivery);
      
      // Esperar 3 segundos entre entregas para no sobrecargar el servidor
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    console.log('✅ [WORKER] Ciclo de entregas completado');

  } catch (error) {
    console.error('❌ [WORKER] Error en worker de entregas:', error);
  }
}

/**
 * Procesa una sola entrega pendiente
 */
async function processSingleDelivery(delivery) {
  try {
    console.log(`🔄 [WORKER] Procesando entrega ${delivery.id}`);
    console.log(`📋 Sale: ${delivery.sale_id}`);
    console.log(`👤 Usuario: ${delivery.username} (${delivery.steam_id})`);
    console.log(`🎮 Producto: ${delivery.product_name}`);
    console.log(`🔁 Intento: ${delivery.attempts + 1}/5`);

    // Actualizar attempts
    const newAttempts = delivery.attempts + 1;

    await supabaseAdmin
      .from('pending_deliveries')
      .update({
        attempts: newAttempts,
        last_attempt_at: new Date().toISOString()
      })
      .eq('id', delivery.id);

    // Extraer configuración RCON
    const serverConfig = delivery.server_config;
    const rconConfig = {
      ip: serverConfig.ip,
      port: parseInt(serverConfig.rcon_port || serverConfig.port, 10),
      password: serverConfig.rcon_password || serverConfig.password
    };

    console.log(`⚡ [WORKER] Conectando a ${rconConfig.ip}:${rconConfig.port}`);

    // Validar configuración
    if (!rconConfig.ip || !rconConfig.port || !rconConfig.password) {
      throw new Error('Configuración RCON incompleta');
    }

    // Preparar variables para los comandos
    const buyer_info = {
      steamid: delivery.steam_id,
      username: delivery.username,
      player: delivery.steam_id,
      orderid: delivery.sale_id
    };

    // Ejecutar comandos
    const result = await executeDeliveryCommands(
      rconConfig,
      delivery.commands,
      buyer_info
    );

    console.log(`📊 [WORKER] Resultado:`, {
      success: result.success,
      successCount: result.successCount,
      failedCount: result.failedCount
    });

    if (result.success) {
      console.log(`✅ [WORKER] Entrega exitosa: ${delivery.id}`);

      // Marcar como completada
      await supabaseAdmin
        .from('pending_deliveries')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          error_message: null
        })
        .eq('id', delivery.id);

      // Actualizar la venta
      await supabaseAdmin
        .from('sales')
        .update({
          delivery_status: 'completed',
          kit_delivered: true,
          delivered_at: new Date().toISOString(),
          notes: `Entregado automáticamente (intento ${newAttempts})`
        })
        .eq('id', delivery.sale_id);

      console.log(`✅ [WORKER] Venta ${delivery.sale_id} actualizada`);

    } else {
      console.log(`⚠️ [WORKER] Entrega falló: ${result.error || result.message}`);

      // Si llegó a 5 intentos, marcar como failed
      if (newAttempts >= 5) {
        console.log(`❌ [WORKER] Máximo de intentos alcanzado para ${delivery.id}`);

        await supabaseAdmin
          .from('pending_deliveries')
          .update({
            status: 'failed',
            error_message: result.error || result.message
          })
          .eq('id', delivery.id);

        await supabaseAdmin
          .from('sales')
          .update({
            delivery_status: 'failed',
            notes: `Falló después de 5 intentos: ${result.error || result.message}`
          })
          .eq('id', delivery.sale_id);

      } else {
        // Actualizar error pero dejar en pending para reintentar
        await supabaseAdmin
          .from('pending_deliveries')
          .update({
            error_message: result.error || result.message
          })
          .eq('id', delivery.id);

        console.log(`🔁 [WORKER] Se reintentará en el próximo ciclo (${newAttempts}/5)`);
      }
    }

  } catch (error) {
    console.error(`❌ [WORKER] Error procesando delivery ${delivery.id}:`, error);

    // Actualizar error
    await supabaseAdmin
      .from('pending_deliveries')
      .update({
        error_message: error.message
      })
      .eq('id', delivery.id);
  }
}

/**
 * Limpiar entregas antiguas completadas (más de 7 días)
 */
export async function cleanupOldDeliveries() {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { error } = await supabaseAdmin
      .from('pending_deliveries')
      .delete()
      .eq('status', 'completed')
      .lt('completed_at', sevenDaysAgo);

    if (error) {
      console.error('❌ [WORKER] Error limpiando entregas antiguas:', error);
    } else {
      console.log('✅ [WORKER] Entregas antiguas limpiadas');
    }
  } catch (error) {
    console.error('❌ [WORKER] Error en cleanup:', error);
  }
}













