// utils/rcon.js
const Rcon = require('rcon-srcds');

/**
 * Valida si un jugador existe en el servidor
 * @param {Object} config - Configuración RCON
 * @param {string} config.ip - IP del servidor
 * @param {number} config.port - Puerto RCON
 * @param {string} config.password - Password RCON
 * @param {string} identifier - Steam ID o Username
 * @returns {Promise<Object>} - { valid: boolean, playerName?: string, error?: string }
 */
async function validatePlayer(config, identifier) {
  let rcon = null;
  
  try {
    console.log(`🔌 Conectando a RCON: ${config.ip}:${config.port}`);
    
    rcon = new Rcon({
      host: config.ip,
      port: config.port,
      password: config.password,
      timeout: 5000
    });

    await rcon.connect();
    console.log('✅ Conectado a RCON');

    // Ejecutar comando 'status' para obtener lista de jugadores
    const response = await rcon.execute('status');
    console.log('📋 Respuesta RCON:', response.substring(0, 200));

    // Parsear la respuesta para buscar al jugador
    const isValid = response.includes(identifier);
    
    if (isValid) {
      // Intentar extraer el nombre del jugador
      const lines = response.split('\n');
      let playerName = identifier;
      
      for (const line of lines) {
        if (line.includes(identifier)) {
          // Intentar extraer el nombre (depende del formato del servidor)
          const match = line.match(/"([^"]+)"/);
          if (match) {
            playerName = match[1];
          }
          break;
        }
      }
      
      return {
        valid: true,
        playerName: playerName,
        message: `Jugador encontrado: ${playerName}`
      };
    } else {
      return {
        valid: false,
        message: 'Jugador no encontrado en el servidor. Asegúrate de estar conectado.'
      };
    }

  } catch (error) {
    console.error('❌ Error RCON:', error.message);
    
    return {
      valid: false,
      error: 'No se pudo conectar al servidor. Verifica que esté online.',
      details: error.message
    };
    
  } finally {
    if (rcon) {
      try {
        await rcon.disconnect();
        console.log('🔌 Desconectado de RCON');
      } catch (e) {
        console.error('Error desconectando:', e);
      }
    }
  }
}

/**
 * Ejecuta comandos RCON para entregar producto
 * @param {Object} config - Configuración RCON
 * @param {Array<string>} commands - Lista de comandos a ejecutar
 * @param {Object} variables - Variables para reemplazar en comandos
 * @returns {Promise<Object>} - { success: boolean, results: Array, error?: string }
 */
async function executeCommands(config, commands, variables) {
  let rcon = null;
  const results = [];
  
  try {
    console.log(`🔌 Conectando para ejecutar ${commands.length} comandos`);
    
    rcon = new Rcon({
      host: config.ip,
      port: config.port,
      password: config.password,
      timeout: 5000
    });

    await rcon.connect();
    console.log('✅ Conectado para ejecución');

    for (const command of commands) {
      // Reemplazar variables en el comando
      let finalCommand = command;
      for (const [key, value] of Object.entries(variables)) {
        finalCommand = finalCommand.replace(new RegExp(`{${key}}`, 'g'), value);
      }
      
      console.log(`▶️ Ejecutando: ${finalCommand}`);
      const result = await rcon.execute(finalCommand);
      results.push({
        command: finalCommand,
        response: result
      });
      
      // Esperar un poco entre comandos
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    return {
      success: true,
      results: results,
      message: `${commands.length} comandos ejecutados correctamente`
    };

  } catch (error) {
    console.error('❌ Error ejecutando comandos:', error.message);
    
    return {
      success: false,
      results: results,
      error: 'Error ejecutando comandos',
      details: error.message
    };
    
  } finally {
    if (rcon) {
      try {
        await rcon.disconnect();
        console.log('🔌 Desconectado');
      } catch (e) {
        console.error('Error desconectando:', e);
      }
    }
  }
}

module.exports = {
  validatePlayer,
  executeCommands
};
