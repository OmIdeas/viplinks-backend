FROM node:20-alpine

WORKDIR /app

# Copiar package files
COPY package*.json ./

# Instalar dependencias
RUN npm ci --only=production

# Copiar TODO el código fuente
COPY . .

# Exponer puerto
EXPOSE 3000

# Comando para iniciar
CMD ["node", "server.js"]
```

4. Commit: "add explicit Dockerfile"

---

### **📋 PASO 2: Crea/Actualiza `.dockerignore` en la raíz**

1. Si ya existe `.dockerignore`, edítalo. Si no, créalo.
2. Contenido:
```
node_modules
npm-debug.log
.git
.gitignore
.env
.DS_Store
*.md
.vscode
.idea
