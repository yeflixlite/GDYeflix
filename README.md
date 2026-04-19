# 📡 VideoProxy Server

Backend proxy **100% gratuito** para reproducir videos desde Doodstream, Streamtape, Streamwish, Filemoon, Dailymotion y más, evitando restricciones CORS.

## ⚡ Instalación y uso rápido

```bash
# 1. Instalar dependencias
npm install

# 2. Iniciar el servidor
node server.js

# 3. Abrir el reproductor
# → http://localhost:3000
```

## 🔌 Endpoints

| Endpoint | Descripción |
|---|---|
| `GET /play?url=<URL>` | Extrae el enlace real del video y devuelve JSON |
| `GET /proxy?url=<URL>&referer=<REF>` | Sirve el contenido del video evitando CORS |

### Respuesta de `/play`
```json
{
  "videoUrl": "https://cdn.ejemplo.com/video.mp4",
  "proxyUrl": "http://localhost:3000/proxy?url=...&referer=...",
  "type": "mp4",
  "provider": "doodstream"
}
```

## 🎬 Proveedores soportados

- ✅ **Doodstream** (dood.re, dood.so, dood.watch, ds2play.com…)
- ✅ **Streamtape** (streamtape.com, streamtape.net…)
- ✅ **Streamwish / Embedwish / Vidhide**
- ✅ **Filemoon**
- ✅ **Dailymotion** (API pública — sin clave)
- ✅ **URLs directas** (mp4, m3u8, webm)
- ✅ **Genérico** (scraping de cualquier página)

## 📂 Estructura del proyecto

```
/project
  /public       → Frontend HTML (reproductor)
  /routes       → play.js, proxy.js
  /controllers  → playController.js, proxyController.js
  /services     → doodstream.js, streamtape.js, streamwish.js, filemoon.js, dailymotion.js, generic.js
  /utils        → browserHeaders.js, urlDetector.js, axiosClient.js
  server.js
  package.json
```

## 🔑 Características

- **Sin caché**: genera un enlace nuevo en cada solicitud
- **Range requests**: soporta adelantar/retroceder en MP4
- **M3U8 rewrite**: reescribe todos los segmentos .ts para que pasen por el proxy
- **Reintentos automáticos**: hasta 3 intentos por proveedor
- **Headers de Chrome**: simula un navegador real
- **100% gratuito**: solo Node.js + librerías open source
