import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url) {
  throw new Error('Missing SUPABASE_URL environment variable');
}

if (!svc) {
  throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY environment variable');
}

export const supabase = createClient(url, anon, {
  auth: { persistSession: false, autoRefreshToken: false }
});

export const supabaseAdmin = createClient(url, svc);
```

- Commit: `fix: clean supabase.js file`

### 2. **Fuerza un rebuild limpio en Railway:**

En Railway:
1. Ve a Settings del servicio
2. Busca **"Redeploy"** o **"Restart"**
3. Haz clic para forzar un nuevo deployment desde cero

### 3. **Si el problema persiste, crea un `.dockerignore` explícito:**

Crea un archivo `.dockerignore` en la raíz con este contenido:
```
node_modules
npm-debug.log
.git
.gitignore
README.md
.env
.DS_Store
