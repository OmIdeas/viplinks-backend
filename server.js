// VipLinks Backend API
// Node.js + Express + Supabase
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const mercadopago = require('mercadopago');
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuracion
const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

// Inicializar clientes
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
mercadopago.configure({ access_token: MP_ACCESS_TOKEN });

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString()
    });
});

// ============= RUTAS DE AUTENTICACIÓN =============

// Registro
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, username } = req.body;
    
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          username: username || email.split('@')[0],
          plan: 'free'
        }
      }
    });
    
    if (error) throw error;
    res.json({ success: true, user: data.user });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });
    
    if (error) throw error;
    res.json({ 
      success: true, 
      user: data.user,
      session: data.session 
    });
  } catch (error) {
    res.status(401).json({ success: false, error: error.message });
  }
});

// Obtener usuario actual
app.get('/api/auth/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) throw new Error('No token provided');
    
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error) throw error;
    res.json({ success: true, user });
  } catch (error) {
    res.status(401).json({ success: false, error: error.message });
  }
});

// Logout
app.post('/api/auth/logout', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const { error } = await supabase.auth.signOut(token);
    
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`VipLinks API corriendo en puerto ${PORT}`);
});
