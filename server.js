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
