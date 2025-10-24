// utils/rcon.js
import { Rcon } from 'rcon-client';

/**
 * Valida si un jugador existe en el servidor
 * Soporta múltiples juegos detectando automáticamente el comando correcto
 */
export async function validatePlayer(config, identifier) {
  let rcon = null;
  
  try {
    // 🔍 LOGS DE DIAGNÓSTICO - INICIO
    console.log('🔍 validatePlayer - config recibido:', JSON.stringify({
      ip: config.ip,
      port: config.port,
      password: config.password ? '***EXISTE***' : 'UNDEFINED/NULL'
    }, null, 2));
    console.log('🔑 Tipo de password:', typeof config.password);
    console.log('🔑 Password value:', config.password);
    // 🔍 LOGS DE DIAGNÓSTICO - FIN
    
    console.log(`🔌 Conectando a RCON: ${config.ip}:${config.port}`);
    
    rcon = new Rcon({
      host: config.ip,
      port: parseInt(config.port),
      timeout: 5000
    });
    await rcon.connect();
    
    console.log('🔐 Intentando autenticar con password:', config.password ? '***EXISTE***' : 'UNDEFINED');
    await rcon.authenticate(config.password);
    console.log('✅ Conectado a RCON');

    // Lista de comandos a probar según el juego
    const commands = [
      'playerlist',      // Rust
      'status',          // CS:GO, Garry's Mod, Source games
      'listplayers',     // ARK, 7 Days to Die
      'list',            // Minecraft
      'players'          // Otros juegos
    ];

    let response = '';
    let workingCommand = '';

    // Probar cada comando hasta encontrar uno que funcione
    for (const cmd of commands) {
      try {
        console.log(`🔍 Probando comando: ${cmd}`);
        response = await rcon.send(cmd);
        
        // Si la respuesta tiene contenido útil, usar este comando
        if (response && response.length > 10) {
          workingCommand = cmd;
          console.log(`✅ Comando funcional: ${cmd}`);
          break;
        }
      } catch (err) {
        console.log(`❌ Comando ${cmd} falló, probando siguiente...`);
        continue;
      }
    }

    if (!response || !workingCommand) {
      return {
        valid: false,
        error: 'No se pudo obtener lista de jugadores del servidor',
        message: 'El servidor no responde a comandos de lista de jugadores'
      };
    }

    console.log('📋 Respuesta del servidor (primeros 500 chars):', response.substring(0, 500));

    // Limpiar el identificador para búsqueda flexible
    const cleanIdentifier = identifier.trim().toLowerCase();
    const responseLines = response.toLowerCase().split('\n');

    // Buscar el identificador en la respuesta (case-insensitive)
    let found = false;
    let playerName = identifier;
    let matchedLine = '';

    for (const line of responseLines) {
      if (line.includes(cleanIdentifier)) {
        found = true;
        matchedLine = line;
        
        // Intentar extraer el nombre del jugador de la línea
        // Diferentes formatos según el juego:
        
        // Formato: "PlayerName" <STEAM_ID>
        let match = line.match(/"([^"]+)"/);
        if (match) {
          playerName = match[1];
          break;
        }
        
        // Formato: PlayerName STEAM_ID (sin comillas)
        match = line.match(/^\s*(\S+)/);
        if (match) {
          playerName = match[1];
          break;
        }
      }
    }

    if (found) {
      console.log(`✅ Jugador encontrado en línea: ${matchedLine}`);
      return {
        valid: true,
        playerName: playerName,
        message: `Jugador encontrado: ${playerName}`,
        command_used: workingCommand
      };
    } else {
      console.log(`❌ Jugador NO encontrado. Buscando: "${cleanIdentifier}"`);
      console.log(`📋 Respuesta completa del servidor:\n${response}`);
      
      return {
        valid: false,
        message: 'Jugador no encontrado en el servidor. Asegúrate de estar conectado y que tu Steam ID o nombre sea correcto.',
        searched_for: identifier,
        command_used: workingCommand
      };
    }
  } catch (error) {
    console.error('❌ Error RCON:', error.message);
    console.error('❌ Error stack:', error.stack);
    
    return {
      valid: false,
      error: 'No se pudo conectar al servidor RCON',
      message: 'Verifica que el servidor esté online y la configuración RCON sea correcta.',
      details: error.message
    };
    
  } finally {
    if (rcon) {
      try {
        await rcon.end();
        console.log('🔌 Desconectado de RCON');
      } catch (e) {
        console.error('Error desconectando:', e);
      }
    }
  }
}

/**
 * Ejecuta comandos RCON para entregar producto
 */
export async function executeDeliveryCommands(config, commands, variables) {
  let rcon = null;
  const results = [];
  
  try {
    console.log(`🔌 Conectando para ejecutar ${commands.length} comandos`);
    
    rcon = new Rcon({
      host: config.ip,
      port: parseInt(config.port),
      timeout: 5000
    });
    await rcon.connect();
    await rcon.authenticate(config.password);
    console.log('✅ Conectado para ejecución');

    for (const command of commands) {
      let finalCommand = command;
      
      // Reemplazar variables en el comando
      for (const [key, value] of Object.entries(variables)) {
        finalCommand = finalCommand.replace(new RegExp(`{${key}}`, 'g'), value);
      }
      
      console.log(`▶️ Ejecutando: ${finalCommand}`);
      
      try {
        const result = await rcon.send(finalCommand);
        results.push({
          command: finalCommand,
          response: result || 'Comando ejecutado correctamente',
          success: true
        });
        console.log(`✅ Comando exitoso`);
      } catch (cmdError) {
        console.error(`❌ Error en comando: ${finalCommand}`, cmdError.message);
        results.push({
          command: finalCommand,
          error: cmdError.message,
          success: false
        });
      }
      
      // Pequeña pausa entre comandos para no saturar el servidor
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    const successCount = results.filter(r => r.success).length;
    const failedCount = results.filter(r => !r.success).length;

    return {
      success: failedCount === 0,
      results: results,
      message: `${successCount}/${commands.length} comandos ejecutados correctamente`,
      successCount,
      failedCount
    };
  } catch (error) {
    console.error('❌ Error ejecutando comandos:', error.message);
    
    return {
      success: false,
      results: results,
      error: 'Error ejecutando comandos RCON',
      message: 'No se pudieron ejecutar todos los comandos',
      details: error.message
    };
    
  } finally {
    if (rcon) {
      try {
        await rcon.end();
        console.log('🔌 Desconectado');
      } catch (e) {
        console.error('Error desconectando:', e);
      }
    }
  }
}

