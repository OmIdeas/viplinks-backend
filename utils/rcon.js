// utils/rcon.js
import Rcon from 'modern-rcon';

/**
 * Valida si un jugador existe en el servidor
 */
export async function validatePlayer(config, identifier) {
  const rcon = new Rcon(config.ip, parseInt(config.port), config.password);
  
  try {
    console.log(`🔌 Conectando a RCON: ${config.ip}:${config.port}`);
    
    await rcon.connect();
    console.log('✅ Conectado a RCON');

    const commands = ['status', 'playerlist', 'listplayers', 'list', 'players'];
    let response = '';
    let workingCommand = '';

    for (const cmd of commands) {
      try {
        console.log(`🔍 Probando: ${cmd}`);
        response = await rcon.send(cmd);
        
        if (response && response.length > 10) {
          workingCommand = cmd;
          console.log(`✅ Comando funcional: ${cmd}`);
          break;
        }
      } catch (err) {
        console.log(`❌ ${cmd} falló: ${err.message}`);
        continue;
      }
    }

    if (!response || !workingCommand) {
      await rcon.disconnect();
      return {
        valid: false,
        error: 'No se pudo obtener lista de jugadores'
      };
    }

    console.log('📋 Respuesta:', response.substring(0, 500));

    const cleanIdentifier = identifier.trim().toLowerCase();
    const found = response.toLowerCase().includes(cleanIdentifier);

    await rcon.disconnect();

    if (found) {
      console.log(`✅ Jugador encontrado`);
      return {
        valid: true,
        playerName: identifier,
        message: 'Jugador encontrado'
      };
    } else {
      console.log(`❌ Jugador NO encontrado`);
      return {
        valid: false,
        message: 'Jugador no encontrado'
      };
    }
    
  } catch (error) {
    console.error('❌ Error RCON:', error.message);
    
    try {
      await rcon.disconnect();
    } catch (e) {}
    
    return {
      valid: false,
      error: 'Error de conexión RCON',
      message: error.message
    };
  }
}

/**
 * Ejecuta comandos RCON para entregar producto
 */
export async function executeDeliveryCommands(config, commands, variables) {
  const rcon = new Rcon(config.ip, parseInt(config.port), config.password, 10000); // 10 segundos timeout
  const results = [];
  
  try {
    console.log(`🔌 Conectando para ejecutar ${commands.length} comandos`);
    
    await rcon.connect();
    console.log('✅ Conectado para ejecución');

    for (const command of commands) {
      let finalCommand = command;
      
      // Reemplazar variables
      for (const [key, value] of Object.entries(variables)) {
        finalCommand = finalCommand.replace(new RegExp(`{${key}}`, 'g'), value);
      }
      
      console.log(`▶️ Ejecutando: ${finalCommand}`);
      
      try {
        const result = await rcon.send(finalCommand);
        results.push({
          command: finalCommand,
          response: result || 'Comando ejecutado',
          success: true
        });
        console.log(`✅ Comando exitoso`);
      } catch (cmdError) {
        console.error(`❌ Error: ${cmdError.message}`);
        results.push({
          command: finalCommand,
          error: cmdError.message,
          success: false
        });
      }
      
      // Pausa entre comandos
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    await rcon.disconnect();

    const successCount = results.filter(r => r.success).length;
    const failedCount = results.filter(r => !r.success).length;

    return {
      success: failedCount === 0,
      results: results,
      message: `${successCount}/${commands.length} comandos ejecutados`,
      successCount,
      failedCount
    };
    
  } catch (error) {
    console.error('❌ Error ejecutando comandos:', error.message);
    
    try {
      await rcon.disconnect();
    } catch (e) {}
    
    return {
      success: false,
      results: results,
      error: 'Error ejecutando comandos',
      message: error.message
    };
  }
}
