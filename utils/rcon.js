// utils/rcon.js
import { Rcon } from 'rcon-client';

export async function validatePlayer(config, identifier) {
  let rcon = null;
  
  try {
    rcon = new Rcon({
      host: config.ip,
      port: parseInt(config.port),
      password: config.password,
      timeout: 60000
    });
    
    await rcon.connect();
    await new Promise(resolve => setTimeout(resolve, 1000));

    const commands = ['status', 'playerlist', 'listplayers', 'list', 'players'];
    let response = '';
    let workingCommand = '';

    for (const cmd of commands) {
      try {
        response = await rcon.send(cmd);
        if (response && response.length > 10) {
          workingCommand = cmd;
          break;
        }
      } catch (err) {
        continue;
      }
    }

    if (!response || !workingCommand) {
      return {
        valid: false,
        error: 'No se pudo obtener lista de jugadores',
        message: 'El servidor no responde'
      };
    }

    const cleanIdentifier = identifier.trim().toLowerCase();
    const responseLines = response.toLowerCase().split('\n');
    let found = false;
    let playerName = identifier;

    for (const line of responseLines) {
      if (line.includes(cleanIdentifier)) {
        found = true;
        const match = line.match(/"([^"]+)"/);
        if (match) playerName = match[1];
        break;
      }
    }

    if (found) {
      return {
        valid: true,
        playerName: playerName,
        message: `Jugador encontrado: ${playerName}`,
        command_used: workingCommand
      };
    }
    
    return {
      valid: false,
      message: 'Jugador no conectado',
      searched_for: identifier,
      command_used: workingCommand
    };
    
  } catch (error) {
    return {
      valid: false,
      error: 'Error conectando a RCON',
      message: 'Servidor offline o configuración incorrecta',
      details: error.message
    };
  } finally {
    if (rcon) {
      try {
        await rcon.end();
      } catch (e) {}
    }
  }
}

export async function executeDeliveryCommands(config, commands, variables) {
  console.log('🔍 [RCON] executeDeliveryCommands llamado');
  console.log('🔍 [RCON] Config:', { ip: config.ip, port: config.port, hasPassword: !!config.password });
  console.log('🔍 [RCON] Commands type:', typeof commands);
  console.log('🔍 [RCON] Commands isArray:', Array.isArray(commands));
  console.log('🔍 [RCON] Commands:', JSON.stringify(commands));
  console.log('🔍 [RCON] Variables:', JSON.stringify(variables));

  // VALIDACIÓN: Verificar que commands sea un array
  if (!commands) {
    console.error('❌ [RCON] Commands es null o undefined');
    return {
      success: false,
      error: 'Commands es null o undefined',
      message: 'No hay comandos para ejecutar',
      results: [],
      successCount: 0,
      failedCount: 0
    };
  }

  if (!Array.isArray(commands)) {
    console.error('❌ [RCON] Commands no es un array:', typeof commands);
    return {
      success: false,
      error: `Commands no es un array (es ${typeof commands})`,
      message: 'Formato de comandos inválido',
      results: [],
      successCount: 0,
      failedCount: 0
    };
  }

  if (commands.length === 0) {
    console.error('❌ [RCON] Commands es un array vacío');
    return {
      success: false,
      error: 'Array de comandos vacío',
      message: 'No hay comandos para ejecutar',
      results: [],
      successCount: 0,
      failedCount: 0
    };
  }

  const MAX_RETRIES = 3;
  const RETRY_DELAY = 3000;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`🔄 [RCON] Intento ${attempt}/${MAX_RETRIES}`);
    const result = await tryExecuteCommands(config, commands, variables);
    
    console.log(`🔍 [RCON] Resultado intento ${attempt}:`, JSON.stringify(result, null, 2));
    
    if (result.success) {
      console.log(`✅ [RCON] Éxito en intento ${attempt}`);
      return result;
    }
    
    console.log(`⚠️ [RCON] Intento ${attempt} falló: ${result.error}`);
    
    if (attempt < MAX_RETRIES) {
      console.log(`⏳ [RCON] Esperando ${RETRY_DELAY}ms antes del siguiente intento...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
    }
  }
  
  console.log(`❌ [RCON] Todos los intentos fallaron`);
  
  return {
    success: false,
    error: 'Todos los intentos fallaron',
    message: `Falló después de ${MAX_RETRIES} intentos`,
    attempts: MAX_RETRIES,
    results: [],
    successCount: 0,
    failedCount: commands.length
  };
}

async function tryExecuteCommands(config, commands, variables) {
  let rcon = null;
  const results = [];
  
  try {
    console.log('🔌 [RCON] Intentando conectar...');
    
    if (!config.ip || !config.port || !config.password) {
      throw new Error('Config RCON incompleta');
    }
    
    rcon = new Rcon({
      host: config.ip,
      port: parseInt(config.port),
      password: config.password,
      timeout: 30000
    });
    
    await rcon.connect();
    console.log('✅ [RCON] Conectado exitosamente');
    
    await new Promise(resolve => setTimeout(resolve, 1500));
    console.log('⏳ [RCON] Esperó 1.5s después de conectar');

    console.log(`📋 [RCON] Ejecutando ${commands.length} comandos...`);

    for (let i = 0; i < commands.length; i++) {
      let finalCommand = commands[i];
      
      console.log(`🔹 [RCON] Comando ${i+1}/${commands.length} original:`, finalCommand);
      
      // Reemplazar variables
      for (const [key, value] of Object.entries(variables)) {
        finalCommand = finalCommand.replace(new RegExp(`{${key}}`, 'g'), value);
      }
      
      console.log(`🔹 [RCON] Comando ${i+1}/${commands.length} procesado:`, finalCommand);
      
      try {
        console.log(`⚡ [RCON] Enviando comando ${i+1}...`);
        const result = await rcon.send(finalCommand);
        console.log(`✅ [RCON] Comando ${i+1} ejecutado:`, result || 'OK');
        
        results.push({
          command: finalCommand,
          response: result || 'OK',
          success: true
        });
        
        if (i < commands.length - 1) {
          console.log(`⏳ [RCON] Esperando 1.5s antes del siguiente comando...`);
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      } catch (cmdError) {
        console.error(`❌ [RCON] Comando ${i+1} falló:`, cmdError.message);
        results.push({
          command: finalCommand,
          error: cmdError.message,
          success: false
        });
        throw new Error(`Comando ${i+1} falló: ${cmdError.message}`);
      }
    }

    const successCount = results.filter(r => r.success).length;
    console.log(`✅ [RCON] Todos los comandos ejecutados: ${successCount}/${commands.length}`);

    return {
      success: true,
      results: results,
      message: `${successCount}/${commands.length} comandos ejecutados`,
      successCount,
      failedCount: commands.length - successCount
    };
    
  } catch (error) {
    console.error('❌ [RCON] Error en tryExecuteCommands:', error.message);
    console.error('❌ [RCON] Stack:', error.stack);
    
    return {
      success: false,
      results: results,
      error: error.message,
      message: 'Error ejecutando comandos',
      details: error.stack,
      successCount: results.filter(r => r.success).length,
      failedCount: commands.length - results.filter(r => r.success).length
    };
  } finally {
    if (rcon) {
      try {
        console.log('🔌 [RCON] Cerrando conexión RCON...');
        await rcon.end();
        console.log('✅ [RCON] Conexión cerrada');
      } catch (e) {
        console.error('⚠️ [RCON] Error cerrando conexión:', e.message);
      }
    }
  }
}
