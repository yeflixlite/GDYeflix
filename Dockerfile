# Usamos una imagen de Node que ya incluya Puppeteer y sus dependencias
FROM ghcr.io/puppeteer/puppeteer:latest

# Directorio de trabajo
WORKDIR /app

# Cambiamos a root para instalar dependencias si es necesario
USER root

# Copiamos los archivos de la app
COPY package*.json ./
RUN npm install

# Copiamos el resto del código
COPY . .

# El puerto que usa Render/Railway suele ser variable
ENV PORT=3000
EXPOSE 3000

# Comando para iniciar
CMD ["node", "server.js"]
