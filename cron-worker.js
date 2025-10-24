// cron-worker.js - Script para ejecutar como cron job en Railway
import { supabaseAdmin } from './supabase.js';
import { executeDeliveryCommands } from './utils/rcon.js';

console.log('🤖 Cron Worker - Procesando entregas pendientes');
console.log('⏰ Ejecutado:', new Date().toISOString());

// Determinar intervalo según tiempo transcurrido
function getNextAttemptDelay(createdAt) {
  const elapsed = Date.now() - new Date(createdAt).getTime();
  const minutes = elapsed / 1000 / 60;
  
  if (minutes < 30) return 5; // 0-30 min: cada 5 min
  if (minutes < 120) return 15; // 30-120 min: cada 15 min
  return 30; // 2-6 horas: cada 30 min
}

async function processDelivery(delivery) {
  const { id, sale_id, steam_id, commands, server_config, attempts, created_at } = delivery;
  
  console.log(`\n📦 Procesando entrega: ${id.slice(0, 8)}...`);
  console.log(`   Steam ID: ${steam_id}`);
  console.log(`   Intento: ${attempts + 1}`);
  
  try {
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
      throw new Error(result.message || 'Error desconocido');
    }
    
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    
    const newAttempts = attempts + 1;
    const now = new Date();
    const expiresAt = new Date(created_at);
    expiresAt.setHours(expiresAt.getHours() + 6);
    
    if (now >= expiresAt) {
      console.log(`⏰ Expiró (6 horas)`);
      
      await supabaseAdmin
        .from('pending_deliveries')
        .update({
          status: 'failed',
          attempts: newAttempts,
          last_attempt: now.toISOString(),
          error_message: 'Expiró después de 6 horas'
        })
        .eq('id', id);
      
      return { success: false, expired: true };
    }
    
    await supabaseAdmin
      .from('pending_deliveries')
      .update({
        attempts: newAttempts,
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
      if (delivery.last_attempt) {
        const lastAttempt = new Date(delivery.last_attempt);
        const minutesSince = (Date.now() - lastAttempt.getTime()) / 1000 / 60;
        const requiredDelay = getNextAttemptDelay(delivery.created_at);
        
        if (minutesSince < requiredDelay) {
          continue;
        }
      }
      
      const result = await processDelivery(delivery);
      
      if (result.success) completed++;
      else if (result.expired) failed++;
      else retrying++;
      
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    console.log(`\n📊 Resumen: ✅ ${completed} | ❌ ${failed} | 🔄 ${retrying}`);
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();
