import express from 'express';
import { createClient } from '@supabase/supabase-js';

const app = express();
app.use(express.json());

// Usa SUPABASE_ANON_KEY si existe, y en su defecto SUPABASE_KEY.
// Así no dependes de un único nombre de variable.
const supabaseAnon = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
const supabaseUrl = process.env.SUPABASE_URL;

const supabase = createClient(supabaseUrl, supabaseAnon, {
  auth: { persistSession: false, autoRefreshToken: false }
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
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
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
app.post('/api/auth/logout', async (_req, res) => {
  // Supabase v2 no requiere (ni acepta) el token aquí. Basta con que el cliente elimine su token.
  res.json({ success: true });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`API running on :${port}`);
});
