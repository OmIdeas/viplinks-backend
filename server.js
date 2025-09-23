const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

const supabaseAnon = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
const supabaseUrl  = process.env.SUPABASE_URL;

const supabase = createClient(supabaseUrl, supabaseAnon, {
  auth: { persistSession: false, autoRefreshToken: false }
});

// Registro
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, username } = req.body;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username: username || email.split('@')[0], plan: 'free' } }
    });
    if (error) throw error;
    res.json({ success: true, user: data.user });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    res.json({ success: true, user: data.user, session: data.session });
  } catch (e) {
    res.status(401).json({ success: false, error: e.message });
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
  } catch (e) {
    res.status(401).json({ success: false, error: e.message });
  }
});

// Logout (no se pasa token en Supabase v2)
app.post('/api/auth/logout', async (_req, res) => {
  res.json({ success: true });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`API running on ${port}`));
