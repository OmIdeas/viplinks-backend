// utils/rcon.js
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Rcon = require('rcon');

/**
 * Valida si un jugador existe en el servidor
 */
export async function validatePlayer(config, identifier) {
  return new Promise((resolve, reject) => {
    console.log(`🔌 Conectando a RCON: ${config.ip}:${config.port}`);
    
    const client = new Rcon(config.ip, parseInt(config.port), config.password, {
      tcp: true,
      challenge: false
    });
    
    let connected = false;
    let commandSent = false;
    
    client.on('auth', () => {
      console.log('✅ Autenticado en RCON');
      connected = true;
      
      // Probar comandos comunes
      const commands = ['status', 'playerlist', 'listplayers'];
      
      client.send(commands[0]);
      commandSent = true;
    });
    
    client.on('response', (response) => {
      console.log('📋 Respuesta RCON recibida');
      
      const cleanIdentifier = identifier.trim().toLowerCase();
      const found = response.toLowerCase().includes(cleanIdentifier);
      
      client.disconnect();
      
      if (found) {
        console.log(`✅ Jugador encontrado`);
        resolve({
          valid: true,
          playerName: identifier,
          message: 'Jugador encontrado'
        });
      } else {
        console.log(`❌ Jugador NO encontrado`);
        resolve({
          valid: false,
          message: 'Jugador no encontrado'
        });
      }
    });
    
    client.on('error', (err) => {
      console.error('❌ Error RCON:', err.message);
      client.disconnect();
      resolve({
        valid: false,
        error: 'Error de conexión',
        message: err.message
      });
    });
    
    client.on('end', () => {
      if (!connected && !commandSent) {
        resolve({
          valid: false,
          error: 'No se pudo conectar',
          message: 'Verifica IP, puerto y contraseña'
        });
      }
    });
    
    // Timeout de 10 segundos
    setTimeout(() => {
      if (!commandSent) {
        client.disconnect();
        resolve({
          valid: false,
          error: 'Timeout',
          message: 'El servidor no responde'
        });
      }
    }, 10000);
    
    client.connect();
  });
}

/**
 * Ejecuta comandos RCON para entregar producto
 */
export async function executeDeliveryCommands(config, commands, variables) {
  return new Promise((resolve, reject) => {
    console.log(`🔌 Conectando para ejecutar ${commands.length} comandos`);
    
    const client = new Rcon(config.ip, parseInt(config.port), config.password, {
      tcp: true,
      challenge: false
    });
    
    const results = [];
    let commandIndex = 0;
    let authenticated = false;
    
    client.on('auth', () => {
      console.log('✅ Autenticado para ejecución');
      authenticated = true;
      
      // Enviar primer comando
      if (commands.length > 0) {
        sendNextCommand();
      } else {
        client.disconnect();
        resolve({
          success: true,
          results: [],
          message: 'No hay comandos para ejecutar'
        });
      }
    });
    
    client.on('response', (response) => {
      results.push({
        command: commands[commandIndex - 1],
        response: response || 'OK',
        success: true
      });
      
      console.log(`✅ Comando ${commandIndex}/${commands.length} ejecutado`);
      
      // Enviar siguiente comando o terminar
      if (commandIndex < commands.length) {
        setTimeout(() => sendNextCommand(), 500);
      } else {
        client.disconnect();
        
        const successCount = results.filter(r => r.success).length;
        
        resolve({
          success: true,
          results: results,
          message: `${successCount}/${commands.length} comandos ejecutados`,
          successCount: successCount,
          failedCount: 0
        });
      }
    });
    
    client.on('error', (err) => {
      console.error('❌ Error:', err.message);
      client.disconnect();
      
      resolve({
        success: false,
        results: results,
        error: 'Error en ejecución',
        message: err.message
      });
    });
    
    function sendNextCommand() {
      if (commandIndex >= commands.length) return;
      
      let command = commands[commandIndex];
      
      // Reemplazar variables
      for (const [key, value] of Object.entries(variables)) {
        command = command.replace(new RegExp(`{${key}}`, 'g'), value);
      }
      
      console.log(`▶️ Ejecutando: ${command}`);
      client.send(command);
      commandIndex++;
    }
    
    // Timeout de 15 segundos
    setTimeout(() => {
      if (!authenticated) {
        client.disconnect();
        resolve({
          success: false,
          results: results,
          error: 'Timeout de conexión',
          message: 'El servidor no responde'
        });
      }
    }, 15000);
    
    client.connect();
  });
}



