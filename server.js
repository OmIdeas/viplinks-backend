import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';

const app = express();
const PORT = process.env.PORT || 3000;

// CORS - IMPORTANTE para que funcione desde app.viplinks.org
app.use(cors({
  origin: ['https://app.viplinks.org', 'http://localhost:3000'],
  credentials: true
}));

app.use(express.json());

// Supabase
const supabaseAnon = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
const supabaseUrl = process.env.SUPABASE_URL;
const supabase = createClient(supabaseUrl, supabaseAnon, {
  auth: { persistSession: false, autoRefreshToken: false }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString() 
  });
});

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

app.listen(PORT, () => {
  console.log(`VipLinks API running on port ${PORT}`);
});
