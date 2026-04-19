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

const playRoutes    = require('./routes/play');
const proxyRoutes   = require('./routes/proxy');
const extractRoutes = require('./routes/extract');
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
app.use('/play',    playRoutes);
app.use('/proxy',   proxyRoutes);
app.use('/extract', extractRoutes);

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
app.listen(PORT, () => {
  console.log(`\n🚀  Server Proxy corriendo en http://localhost:${PORT}`);
  console.log(`📺  Abre el reproductor en  http://localhost:${PORT}/\n`);
});
