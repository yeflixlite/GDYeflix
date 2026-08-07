# Usamos una imagen de Node que ya incluya Puppeteer y sus dependencias
FROM ghcr.io/puppeteer/puppeteer:latest

# Directorio de trabajo
WORKDIR /app

# Cambiamos a root para instalar dependencias y asegurar permisos
USER root

# Copiamos los archivos de la app
COPY package*.json ./
RUN npm install --production

# Copiamos el resto del código
COPY . .

# Hugging Face Spaces usa el puerto 7860 por defecto
ENV PORT=7860
EXPOSE 7860

# Comando para iniciar
CMD ["node", "server.js"]
