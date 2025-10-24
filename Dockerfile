FROM node:20-bookworm-slim
WORKDIR /app

# Instalar dependencias del package.json
COPY package*.json ./
RUN npm install --omit=dev

# Copiar el resto del proyecto
COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Comando de arranque
CMD ["node", "server.js"]
