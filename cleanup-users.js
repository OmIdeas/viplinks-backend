// cleanup-users.js - Script para limpiar datos JSON corruptos
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

function cleanJsonString(value) {
  if (!value || typeof value !== 'string') return value;
  
  // Si contiene JSON, extraer el username
  if (value.includes('{') && value.includes('"username"')) {
    try {
      const parsed = JSON.parse(value);
      return parsed.username || value;
    } catch {
      // Extraer con regex
      const match = value.match(/"username":"([^"]+)"/);
      if (match && match[1]) {
        return match[1];
      }
    }
  }
  
  // Si no es JSON problemático, devolver tal como está
  return value;
}

async function cleanupCorruptedUsers() {
  try {
    console.log('🔍 Buscando usuarios con datos corruptos...');
    
    // Obtener todos los usuarios
    const { data: users, error: fetchError } = await supabase
      .from('users')
      .select('*');
    
    if (fetchError) {
      throw new Error(`Error al obtener usuarios: ${fetchError.message}`);
    }
    
    console.log(`📊 Total de usuarios: ${users.length}`);
    
    // Filtrar usuarios con datos corruptos
    const corruptedUsers = users.filter(user => 
      (user.username && user.username.includes('{')) ||
      (user.full_name && user.full_name.includes('{')) ||
      (user.name && user.name.includes('{')) ||
      (user.display_name && user.display_name.includes('{'))
    );
    
    console.log(`⚠️  Usuarios con datos corruptos: ${corruptedUsers.length}`);
    
    if (corruptedUsers.length === 0) {
      console.log('✅ No hay datos corruptos para limpiar');
      return;
    }
    
    // Mostrar usuarios que se van a limpiar
    corruptedUsers.forEach(user => {
      console.log(`🔧 Limpiando usuario: ${user.email}`);
      console.log(`   Username: ${user.username} -> ${cleanJsonString(user.username)}`);
    });
    
    // Limpiar cada usuario corrupto
    let cleanedCount = 0;
    for (const user of corruptedUsers) {
      const cleanedData = {
        username: cleanJsonString(user.username),
        full_name: cleanJsonString(user.full_name),
        name: cleanJsonString(user.name),
        display_name: cleanJsonString(user.display_name)
      };
      
      const { error: updateError } = await supabase
        .from('users')
        .update(cleanedData)
        .eq('id', user.id);
      
      if (updateError) {
        console.error(`❌ Error actualizando usuario ${user.email}:`, updateError.message);
      } else {
        cleanedCount++;
        console.log(`✅ Usuario limpiado: ${user.email} -> ${cleanedData.username}`);
      }
    }
    
    console.log(`🎉 Limpieza completada: ${cleanedCount}/${corruptedUsers.length} usuarios actualizados`);
    
    // Verificar que no quedan datos corruptos
    const { data: verification, error: verifyError } = await supabase
      .from('users')
      .select('id, email, username, full_name')
      .or('username.like.{%,full_name.like.{%,name.like.{%,display_name.like.{%');
    
    if (verifyError) {
      console.warn('⚠️ No se pudo verificar la limpieza:', verifyError.message);
    } else if (verification.length === 0) {
      console.log('✅ Verificación exitosa: No quedan datos corruptos');
    } else {
      console.log(`⚠️ Aún quedan ${verification.length} usuarios con datos problemáticos`);
    }
    
  } catch (error) {
    console.error('❌ Error en la limpieza:', error.message);
  }
}

// Ejecutar el script
cleanupCorruptedUsers().then(() => {
  console.log('🏁 Script de limpieza finalizado');
  process.exit(0);
}).catch(error => {
  console.error('💥 Error fatal:', error);
  process.exit(1);
});
