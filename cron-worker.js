// cron-worker.js - Sistema de reintentos con advertencias y tracking mejorado
import { supabaseAdmin } from './supabase.js';
import { executeDeliveryCommands } from './utils/rcon.js';

console.log('🤖 Cron Worker - Procesando entregas pendientes');
console.log('⏰ Ejecutado:', new Date().toISOString());

// Determinar intervalo según tiempo transcurrido (ACTUALIZADO A 10 MIN)
function getNextAttemptDelay(createdAt) {
  const elapsed = Date.now() - new Date(createdAt).getTime();
  const minutes = elapsed / 1000 / 60;
  
  if (minutes < 30) return 10;  // 0-30 min: cada 10 min
  if (minutes < 120) return 20; // 30-120 min: cada 20 min
  return 30;                    // 2-6 horas: cada 30 min
}

// Enviar mensaje al chat del juego usando RCON
async function sendGameMessage(serverConfig, message) {
  try {
    // Usar el formato de comando apropiado según el juego
    // "say" funciona en Rust, CS:GO, Source games
    const commands = [
      `say "${message}"`,
      `broadcast ${message}`, // Alternativo para algunos juegos
    ];
    
    for (const cmd of commands) {
      try {
        await executeDeliveryCommands(
          serverConfig,
          [cmd],
          {}
        );
        console.log(`📢 Mensaje enviado: ${message}`);
        return true;
      } catch (err) {
        // Si falla, probar el siguiente formato
        continue;
      }
    }
    
    return false;
  } catch (error) {
    console.error(`❌ Error enviando mensaje al juego:`, error.message);
    return false;
  }
}

async function processDelivery(delivery) {
  const { 
    id, 
    sale_id, 
    steam_id, 
    commands, 
    server_config, 
    attempts, 
    inventory_fail_count,
    created_at 
  } = delivery;
  
  console.log(`\n📦 Procesando entrega: ${id.slice(0, 8)}...`);
  console.log(`   Steam ID: ${steam_id}`);
  console.log(`   Intento: ${attempts + 1}`);
  console.log(`   Fallos por inventario: ${inventory_fail_count || 0}`);
  
  try {
    // ============================================
    // MENSAJES DE ADVERTENCIA ANTES DE ENTREGAR
    // ============================================
    
    const failCount = inventory_fail_count || 0;
    
    if (failCount < 3) {
      // PRIMEROS 3 INTENTOS: Mensaje estándar
      console.log('📢 Enviando advertencia (1 minuto antes)...');
      
      await sendGameMessage(server_config, '⚠️ [VipLinks] Tienes una compra pendiente');
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      await sendGameMessage(server_config, 'Asegúrate de tener espacio en tu inventario');
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      await sendGameMessage(server_config, 'La entrega se realizará en 1 minuto...');
      
      console.log('⏳ Esperando 60 segundos...');
      await new Promise(resolve => setTimeout(resolve, 60000)); // 1 minuto
      
    } else {
      // DESPUÉS DE 3 INTENTOS: Mensaje alternativo
      console.log('📢 Enviando advertencia (4to+ intento)...');
      
      await sendGameMessage(server_config, '⚠️ [VipLinks] No se pudo completar la entrega');
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      await sendGameMessage(server_config, 'Se reintentará en los próximos 10 minutos');
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      await sendGameMessage(server_config, 'Si el problema persiste, contacta al vendedor para entrega manual');
      
      console.log('⏳ Esperando 60 segundos...');
      await new Promise(resolve => setTimeout(resolve, 60000)); // 1 minuto
    }
    
    // ============================================
    // INTENTAR ENTREGA
    // ============================================
    
    console.log('🎮 Ejecutando comandos de entrega...');
    
    const result = await executeDeliveryCommands(
      server_config,
      commands,
      {
        player: steam_id,
        steamid: steam_id,
        username: steam_id
      }
    );
    
    if (result.success) {
      console.log(`✅ Entrega exitosa`);
      
      // Enviar mensaje de confirmación
      await sendGameMessage(server_config, '✅ [VipLinks] ¡Compra entregada exitosamente!');
      
      // Marcar como completada
      await supabaseAdmin
        .from('pending_deliveries')
        .update({
          status: 'completed',
          last_attempt: new Date().toISOString()
        })
        .eq('id', id);
      
      await supabaseAdmin
        .from('sales')
        .update({
          delivery_status: 'completed',
          delivered_at: new Date().toISOString()
        })
        .eq('id', sale_id);
      
      return { success: true };
      
    } else {
      throw new Error(result.message || result.error || 'Error desconocido');
    }
    
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    
    const newAttempts = attempts + 1;
    const newInventoryFailCount = (inventory_fail_count || 0) + 1;
    const now = new Date();
    const expiresAt = new Date(created_at);
    expiresAt.setHours(expiresAt.getHours() + 6);
    
    // Verificar si expiró (6 horas)
    if (now >= expiresAt) {
      console.log(`⏰ Expiró (6 horas)`);
      
      // Enviar mensaje final al jugador
      await sendGameMessage(
        server_config, 
        '⚠️ [VipLinks] La entrega automática expiró. Contacta al vendedor.'
      );
      
      await supabaseAdmin
        .from('pending_deliveries')
        .update({
          status: 'failed',
          attempts: newAttempts,
          inventory_fail_count: newInventoryFailCount,
          last_attempt: now.toISOString(),
          error_message: 'Expiró después de 6 horas'
        })
        .eq('id', id);
      
      // Actualizar venta para que vendedor sepa que debe entregar manualmente
      await supabaseAdmin
        .from('sales')
        .update({
          delivery_status: 'failed',
          notes: 'Entrega automática falló después de 6 horas. Requiere entrega manual por el vendedor.'
        })
        .eq('id', sale_id);
      
      return { success: false, expired: true };
    }
    
    // Actualizar intentos
    await supabaseAdmin
      .from('pending_deliveries')
      .update({
        attempts: newAttempts,
        inventory_fail_count: newInventoryFailCount,
        last_attempt: now.toISOString(),
        error_message: error.message
      })
      .eq('id', id);
    
    return { success: false, retry: true };
  }
}

async function main() {
  try {
    const { data: deliveries, error } = await supabaseAdmin
      .from('pending_deliveries')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(50);
    
    if (error) throw error;
    
    if (!deliveries || deliveries.length === 0) {
      console.log('✅ No hay entregas pendientes');
      process.exit(0);
    }
    
    console.log(`📋 ${deliveries.length} entregas pendientes`);
    
    let completed = 0, failed = 0, retrying = 0;
    
    for (const delivery of deliveries) {
      // Verificar si debe intentarse ahora según el intervalo
      if (delivery.last_attempt) {
        const lastAttempt = new Date(delivery.last_attempt);
        const minutesSince = (Date.now() - lastAttempt.getTime()) / 1000 / 60;
        const requiredDelay = getNextAttemptDelay(delivery.created_at);
        
        if (minutesSince < requiredDelay) {
          const waitTime = Math.ceil(requiredDelay - minutesSince);
          console.log(`⏸️ Entrega ${delivery.id.slice(0, 8)}... - Próximo intento en ${waitTime} min`);
          continue;
        }
      }
      
      const result = await processDelivery(delivery);
      
      if (result.success) completed++;
      else if (result.expired) failed++;
      else retrying++;
      
      // Pausa de 3 segundos entre entregas
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    console.log(`\n📊 Resumen: ✅ ${completed} | ❌ ${failed} | 🔄 ${retrying}`);
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();
