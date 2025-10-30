// utils/rcon.js
import { Rcon } from 'rcon-client';

export async function validatePlayer(config, identifier) {
  let rcon = null;
  
  try {
    rcon = new Rcon({
      host: config.ip,
      port: parseInt(config.port),
      password: config.password,
      timeout: 30000
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
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 3000;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const result = await tryExecuteCommands(config, commands, variables);
    
    if (result.success) {
      return result;
    }
    
    if (attempt < MAX_RETRIES) {
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
    }
  }
  
  return {
    success: false,
    error: 'Todos los intentos fallaron',
    message: `Falló después de ${MAX_RETRIES} intentos`,
    attempts: MAX_RETRIES
  };
}

async function tryExecuteCommands(config, commands, variables) {
  let rcon = null;
  const results = [];
  
  try {
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
    await new Promise(resolve => setTimeout(resolve, 1500));

    for (let i = 0; i < commands.length; i++) {
      let finalCommand = commands[i];
      
      for (const [key, value] of Object.entries(variables)) {
        finalCommand = finalCommand.replace(new RegExp(`{${key}}`, 'g'), value);
      }
      
      try {
        const result = await rcon.send(finalCommand);
        results.push({
          command: finalCommand,
          response: result || 'OK',
          success: true
        });
        
        if (i < commands.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      } catch (cmdError) {
        results.push({
          command: finalCommand,
          error: cmdError.message,
          success: false
        });
        throw new Error(`Comando ${i+1} falló: ${cmdError.message}`);
      }
    }

    const successCount = results.filter(r => r.success).length;

    return {
      success: true,
      results: results,
      message: `${successCount}/${commands.length} comandos ejecutados`,
      successCount,
      failedCount: commands.length - successCount
    };
    
  } catch (error) {
    return {
      success: false,
      results: results,
      error: error.message,
      message: 'Error ejecutando comandos',
      details: error.stack
    };
  } finally {
    if (rcon) {
      try {
        await rcon.end();
      } catch (e) {}
    }
  }
}
