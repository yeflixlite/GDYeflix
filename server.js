/**
 * ============================================================
 *  VIDEO PROXY SERVER  –  server.js
 *  Punto de entrada principal del servidor Express
 *  100% gratuito · Node.js + Express + Axios
 * ============================================================
 */

'use strict';

const express = require('express');
const cors    = require('cors');
const path    = require('path');

const { embedHandler } = require('./controllers/embedController');

const app  = express();
const PORT = process.env.PORT || 3000;

// Configurar confianza en el proxy para Render/HTTPS
app.set('trust proxy', true);

// ── Middlewares globales ──────────────────────────────────────
app.use(cors({ origin: '*', methods: ['GET', 'HEAD', 'OPTIONS'] }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Sirve el frontend estático desde /public
app.use(express.static(path.join(__dirname, 'public')));

// ── Rutas de la API ───────────────────────────────────────────
app.use('/play',  require('./routes/play'));
app.use('/proxy', require('./routes/proxy'));
app.use('/extract', require('./routes/extract'));
app.use('/fetch', require('./routes/fetch'));   // Proxy HTML ligero para PelisJuanita
app.use('/api/tv', require('./routes/tv')); // Nueva ruta para TV

// Servir reproductor dedicado para TV (live.html)
app.get('/live', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'live.html'));
});

// Ruta para compartir/embedear: /v?url=...
app.get('/v', embedHandler);

// ── Ruta raíz  ────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Manejador de errores global ───────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[ERROR]', err.message || err);
  if (res.headersSent) return; 
  res.status(500).json({ 
    ok: false,
    error: err.message || 'Error interno del servidor' 
  });
});

// ── Inicio ────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`\n🚀  Server Proxy corriendo en http://localhost:${PORT}`);
    console.log(`📺  Abre el reproductor en  http://localhost:${PORT}/\n`);
  });
}

module.exports = app;
