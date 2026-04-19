# 🌐 Video Streaming Proxy (HGCloud & StreamWish)

Servidor proxy robusto desarrollado en Node.js para extraer y reproducir videos de proveedores protegidos (HGCloud, StreamWish, Doodstream, etc.) sin restricciones de CORS y con soporte para múltiples idiomas y calidades.

## 🚀 Características
- **Extracción Inteligente**: Sistema dual (HTTP + Puppeteer) para saltar protecciones de JavaScript.
- **Multi-Idioma**: Soporte completo para elegir pistas de audio (Español, Inglés, etc.).
- **Selector de Calidad**: Permite cambiar entre 1080p, 720p, 480p o modo Automático.
- **Filtro Anti-Trabas**: Elimina anuncios y trackers que bloquean la reproducción.
- **Embed Ready**: Genera enlaces listos para compartir o insertar en otras webs.

## 🔗 Cómo compartir videos
Para compartir un video con tus compañeros, usa el siguiente formato de URL:

`https://TU-DOMINIO.onrender.com/v?url=URL_DEL_VIDEO`

**Ejemplo:**
`https://TU-DOMINIO.onrender.com/v?url=https://hgcloud.to/e/yvapz6js5a01`

## 🛠️ Instalación y Despliegue (Render.com)
1. Conecta este repositorio a un **Web Service** en Render.
2. Render detectará el `Dockerfile` automáticamente.
3. Asegúrate de que el puerto sea el `3000`.

## 🔋 Mantener 24/7 Gratis
Como Render duerme los servicios gratuitos tras 15 min de inactividad, usa [Cron-job.org](https://cron-job.org) para hacer un "ping" a tu URL cada 10 minutos.

---
**Desarrollado para yeflix2025**
