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

// ===== ADMIN CHECK =====
const ADMIN_EMAILS = (proceso.entorno.ADMIN_EMAILS || '')
  .split(',')
  .map(e => e.trim().toLowerCase())

async function requerirAdmin(req, res, next) {
  try {
    const auth = req.headers.authorization || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
    if (!token) return res.status(401).json({ error: 'Falta token' })

    const { data, error } = await supabase.auth.getUser(token)
    if (error || !data?.user) return res.status(401).json({ error: 'Token inválido' })
    const user = data.user

    const email = (user.email || '').toLowerCase()
    const isAdmin = user.app_metadata?.is_admin === true || ADMIN_EMAILS.includes(email)

    if (!isAdmin) return res.status(403).json({ error: 'Solo admin' })

    req.user = user
    next()
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Error en verificación admin' })
  }
}

// Ruta de prueba admin
aplicación.get('/api/admin/panel', requerirAdmin, (req, res) => {
  res.json({ msg: `Bienvenido admin ${req.user.email}` })
})
// ===== /ADMIN CHECK =====


// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString()
    });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`VipLinks API corriendo en puerto ${PORT}`);
});


