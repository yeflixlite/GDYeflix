/**
 * ============================================================
 *  controllers/embedController.js
 *  Reproductor embed estilo YouTube — rojo, con controles
 *  personalizados, menú de calidad e idioma tipo engranaje.
 * ============================================================
 */

'use strict';

async function embedHandler(req, res, next) {
  try {
    const { url } = req.query;

    if (!url) {
      return res.status(400).send('Error: Falta el parámetro ?url= en el embed.');
    }

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Yeflix · Reproductor</title>
    <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap" rel="stylesheet">
    <style>
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        body, html {
            width: 100%; height: 100%;
            background: #000;
            font-family: 'Roboto', sans-serif;
            overflow: hidden;
            user-select: none;
            -webkit-user-select: none;
        }

        /* ── Contenedor principal ─────────────────────────── */
        #player-wrap {
            position: relative;
            width: 100%; height: 100%;
            background: #000;
            cursor: none;
        }
        #player-wrap.controls-visible { cursor: default; }

        video {
            width: 100%; height: 100%;
            display: block;
            background: #000;
        }

        /* ── Loader inicial estilo Yeflix ─────────────────── */
        #loader {
            position: absolute; inset: 0; z-index: 200;
            background: #000;
            display: flex; flex-direction: column;
            align-items: center; justify-content: center;
            transition: opacity 0.6s ease;
        }
        #loader.hidden { opacity: 0; pointer-events: none; }

        .yx-logo {
            font-family: 'Roboto', sans-serif;
            font-weight: 700;
            font-size: 48px;
            letter-spacing: 6px;
            color: #ff0000;
            text-transform: uppercase;
            margin-bottom: 36px;
            text-shadow: 0 0 40px rgba(255,0,0,0.4);
        }
        .yx-spinner-ring {
            width: 52px; height: 52px;
            border: 3px solid rgba(255,255,255,0.08);
            border-top-color: #ff0000;
            border-radius: 50%;
            animation: spin 0.9s linear infinite;
        }
        .yx-loader-text {
            margin-top: 18px;
            font-size: 13px;
            color: rgba(255,255,255,0.4);
            letter-spacing: 1px;
            font-weight: 400;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* ── Error ────────────────────────────────────────── */
        #error-view {
            position: absolute; inset: 0; z-index: 210;
            display: none; flex-direction: column;
            align-items: center; justify-content: center;
            background: #000; color: #fff; gap: 12px;
        }
        #error-view svg { color: #ff0000; }
        #error-view p { font-size: 15px; color: rgba(255,255,255,0.7); max-width: 320px; text-align: center; }

        /* ── Buffering overlay ────────────────────────────── */
        #buffering {
            position: absolute; inset: 0; z-index: 50;
            display: none; align-items: center; justify-content: center;
            pointer-events: none;
        }
        #buffering.visible { display: flex; }
        .buf-ring {
            width: 50px; height: 50px;
            border: 3px solid rgba(255,255,255,0.15);
            border-top-color: #ff0000;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
        }

        /* ── Gradiente inferior ───────────────────────────── */
        #controls-gradient {
            position: absolute; bottom: 0; left: 0; right: 0;
            height: 120px;
            background: linear-gradient(transparent, rgba(0,0,0,0.85));
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.25s;
        }
        #player-wrap.controls-visible #controls-gradient { opacity: 1; }

        /* ── Barra de controles ───────────────────────────── */
        #controls {
            position: absolute; bottom: 0; left: 0; right: 0;
            padding: 0 12px 10px;
            display: flex; flex-direction: column; gap: 4px;
            opacity: 0;
            transition: opacity 0.25s;
            z-index: 100;
        }
        #player-wrap.controls-visible #controls { opacity: 1; }

        /* ── Barra de progreso ────────────────────────────── */
        #progress-area {
            position: relative;
            width: 100%;
            height: 16px;
            display: flex; align-items: center;
            cursor: pointer;
        }
        #progress-track {
            position: relative;
            width: 100%;
            height: 3px;
            background: rgba(255,255,255,0.25);
            border-radius: 2px;
            transition: height 0.15s ease;
            overflow: hidden;
        }
        #progress-area:hover #progress-track { height: 5px; }
        #progress-fill {
            height: 100%;
            background: #ff0000;
            border-radius: 2px;
            width: 0%;
            transition: width 0.1s linear;
            position: relative;
        }
        #progress-fill::after {
            content: '';
            position: absolute; right: -5px; top: 50%;
            transform: translateY(-50%) scale(0);
            width: 12px; height: 12px;
            background: #ff0000;
            border-radius: 50%;
            transition: transform 0.15s ease;
        }
        #progress-area:hover #progress-fill::after { transform: translateY(-50%) scale(1); }
        #progress-buffer {
            position: absolute; left: 0; top: 0;
            height: 100%;
            background: rgba(255,255,255,0.2);
            border-radius: 2px;
            width: 0%;
        }

        /* ── Fila de botones ──────────────────────────────── */
        #controls-row {
            display: flex;
            align-items: center;
            gap: 4px;
        }
        .ctrl-btn {
            background: none; border: none;
            color: #fff; cursor: pointer;
            width: 36px; height: 36px;
            display: flex; align-items: center; justify-content: center;
            border-radius: 50%;
            transition: background 0.15s;
            flex-shrink: 0;
        }
        .ctrl-btn:hover { background: rgba(255,255,255,0.12); }
        .ctrl-btn svg { width: 22px; height: 22px; fill: currentColor; }

        /* ── Tiempo ───────────────────────────────────────── */
        #time-display {
            font-size: 13px;
            color: #fff;
            white-space: nowrap;
            margin: 0 4px;
            font-variant-numeric: tabular-nums;
        }

        /* ── Volumen ──────────────────────────────────────── */
        #volume-wrap {
            display: flex; align-items: center; gap: 4px;
        }
        #volume-slider-wrap {
            width: 0;
            overflow: hidden;
            transition: width 0.2s ease;
        }
        #volume-wrap:hover #volume-slider-wrap { width: 72px; }
        #volume-slider {
            -webkit-appearance: none;
            width: 72px; height: 3px;
            background: linear-gradient(to right, #fff 100%, rgba(255,255,255,0.3) 100%);
            border-radius: 2px;
            outline: none;
            cursor: pointer;
        }
        #volume-slider::-webkit-slider-thumb {
            -webkit-appearance: none;
            width: 12px; height: 12px;
            border-radius: 50%;
            background: #fff;
            cursor: pointer;
        }

        /* ── Espaciador ───────────────────────────────────── */
        .spacer { flex: 1; }

        /* ── Botón de ajustes ─────────────────────────────── */
        #settings-btn { position: relative; }

        /* ── Panel de ajustes estilo YouTube ─────────────── */
        #settings-panel {
            position: absolute;
            bottom: 52px; right: 8px;
            background: rgba(28,28,28,0.97);
            border-radius: 12px;
            overflow: hidden;
            min-width: 200px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.6);
            display: none;
            flex-direction: column;
            z-index: 300;
            backdrop-filter: blur(12px);
        }
        #settings-panel.open { display: flex; }

        /* ── Vistas del panel ─────────────────────────────── */
        .panel-view { display: flex; flex-direction: column; }
        .panel-view.hidden { display: none; }

        .panel-header {
            display: flex; align-items: center; gap: 8px;
            padding: 10px 16px 8px;
            border-bottom: 1px solid rgba(255,255,255,0.08);
            cursor: pointer;
        }
        .panel-header:hover { background: rgba(255,255,255,0.06); }
        .panel-header svg { width: 18px; height: 18px; fill: #fff; flex-shrink: 0; }
        .panel-header-label { font-size: 13px; color: rgba(255,255,255,0.7); flex: 1; }

        .panel-item {
            display: flex; align-items: center; justify-content: space-between;
            padding: 10px 16px;
            cursor: pointer;
            gap: 10px;
            transition: background 0.1s;
        }
        .panel-item:hover { background: rgba(255,255,255,0.08); }
        .panel-item-label { font-size: 14px; color: #fff; font-weight: 500; }
        .panel-item-value { font-size: 13px; color: rgba(255,255,255,0.55); }
        .panel-item-icon { width: 16px; height: 16px; fill: rgba(255,255,255,0.55); flex-shrink: 0; }

        /* Sub-panel */
        .subpanel-item {
            display: flex; align-items: center; gap: 10px;
            padding: 10px 16px;
            cursor: pointer;
            transition: background 0.1s;
        }
        .subpanel-item:hover { background: rgba(255,255,255,0.08); }
        .subpanel-item.active .subpanel-dot { background: #ff0000; }
        .subpanel-item.active .subpanel-text { color: #fff; font-weight: 500; }
        .subpanel-dot {
            width: 8px; height: 8px;
            border-radius: 50%;
            background: transparent;
            border: 2px solid rgba(255,255,255,0.4);
            flex-shrink: 0;
        }
        .subpanel-text { font-size: 14px; color: rgba(255,255,255,0.75); }

        /* ── Título del subpanel ──────────────────────────── */
        .subpanel-title {
            display: flex; align-items: center; gap: 8px;
            padding: 10px 16px 8px;
            border-bottom: 1px solid rgba(255,255,255,0.08);
            cursor: pointer;
        }
        .subpanel-title:hover { background: rgba(255,255,255,0.06); }
        .subpanel-title svg { width: 18px; height: 18px; fill: rgba(255,255,255,0.7); }
        .subpanel-title span { font-size: 14px; color: rgba(255,255,255,0.9); font-weight: 500; }

        /* ── Click para play/pause (área central) ─────────── */
        #click-area {
            position: absolute; inset: 0;
            z-index: 10;
            cursor: pointer;
        }

        /* ── Ripple de play/pause ─────────────────────────── */
        #play-ripple {
            position: absolute; top: 50%; left: 50%;
            transform: translate(-50%, -50%) scale(0);
            width: 72px; height: 72px;
            border-radius: 50%;
            background: rgba(0,0,0,0.5);
            display: flex; align-items: center; justify-content: center;
            z-index: 20; pointer-events: none;
            transition: transform 0.12s ease, opacity 0.3s ease;
            opacity: 0;
        }
        #play-ripple.show { transform: translate(-50%, -50%) scale(1); opacity: 1; }
        #play-ripple.hide { transform: translate(-50%, -50%) scale(1.3); opacity: 0; }
        #play-ripple svg { width: 32px; height: 32px; fill: #fff; }

        /* ── Logo watermark ───────────────────────────────── */
        #watermark {
            position: absolute; top: 14px; left: 16px;
            font-size: 18px; font-weight: 700;
            color: #ff0000; letter-spacing: 3px;
            opacity: 0; z-index: 90;
            transition: opacity 0.3s;
            pointer-events: none;
            text-shadow: 0 1px 6px rgba(0,0,0,0.6);
        }
        #player-wrap.controls-visible #watermark { opacity: 1; }

    </style>
</head>
<body>

<div id="player-wrap">

    <!-- Loader inicial -->
    <div id="loader">
        <div class="yx-logo">YEFLIX</div>
        <div class="yx-spinner-ring"></div>
        <div class="yx-loader-text">Cargando video...</div>
    </div>

    <!-- Error -->
    <div id="error-view">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="#ff0000" stroke-width="1.5"/>
            <path d="M12 8v4M12 16h.01" stroke="#ff0000" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <p id="error-text">No se pudo cargar el video.</p>
    </div>

    <!-- Área de click ─ play/pause central -->
    <div id="click-area"></div>

    <!-- Ripple animado al click -->
    <div id="play-ripple">
        <svg id="ripple-icon" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
    </div>

    <!-- Buffering -->
    <div id="buffering"><div class="buf-ring"></div></div>

    <!-- Video -->
    <video id="video" playsinline></video>

    <!-- Logo watermark -->
    <div id="watermark">YEFLIX</div>

    <!-- Gradiente inferior -->
    <div id="controls-gradient"></div>

    <!-- Controles -->
    <div id="controls">

        <!-- Barra de progreso -->
        <div id="progress-area">
            <div id="progress-track">
                <div id="progress-buffer"></div>
                <div id="progress-fill"></div>
            </div>
        </div>

        <!-- Fila de botones -->
        <div id="controls-row">

            <!-- Play/Pause -->
            <button class="ctrl-btn" id="playpause-btn" title="Reproducir/Pausar">
                <svg id="pp-icon" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
            </button>

            <!-- Volumen -->
            <div id="volume-wrap">
                <button class="ctrl-btn" id="mute-btn" title="Silenciar">
                    <svg id="vol-icon" viewBox="0 0 24 24">
                        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
                    </svg>
                </button>
                <div id="volume-slider-wrap">
                    <input type="range" id="volume-slider" min="0" max="1" step="0.05" value="1">
                </div>
            </div>

            <!-- Tiempo -->
            <span id="time-display">0:00 / 0:00</span>

            <div class="spacer"></div>

            <!-- Ajustes -->
            <div style="position:relative">
                <button class="ctrl-btn" id="settings-btn" title="Ajustes">
                    <svg viewBox="0 0 24 24">
                        <path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
                    </svg>
                </button>

                <!-- Panel de ajustes -->
                <div id="settings-panel">

                    <!-- Vista principal -->
                    <div class="panel-view" id="panel-main">
                        <div class="panel-item" id="menu-quality">
                            <span class="panel-item-label">Calidad</span>
                            <span class="panel-item-value" id="quality-current">Auto</span>
                            <svg class="panel-item-icon" viewBox="0 0 24 24"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
                        </div>
                        <div class="panel-item" id="menu-audio" style="display:none">
                            <span class="panel-item-label">Idioma</span>
                            <span class="panel-item-value" id="audio-current">—</span>
                            <svg class="panel-item-icon" viewBox="0 0 24 24"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
                        </div>
                    </div>

                    <!-- Vista de calidades -->
                    <div class="panel-view hidden" id="panel-quality">
                        <div class="subpanel-title" id="back-from-quality">
                            <svg viewBox="0 0 24 24"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
                            <span>Calidad</span>
                        </div>
                        <div id="quality-list"></div>
                    </div>

                    <!-- Vista de idiomas -->
                    <div class="panel-view hidden" id="panel-audio">
                        <div class="subpanel-title" id="back-from-audio">
                            <svg viewBox="0 0 24 24"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
                            <span>Idioma</span>
                        </div>
                        <div id="audio-list"></div>
                    </div>

                </div>
            </div>

            <!-- Pantalla completa -->
            <button class="ctrl-btn" id="fullscreen-btn" title="Pantalla completa">
                <svg id="fs-icon" viewBox="0 0 24 24">
                    <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
                </svg>
            </button>

        </div>
    </div>
</div>

<script>
(function() {
    'use strict';

    // ── Referencias DOM ────────────────────────────────────────
    const wrap          = document.getElementById('player-wrap');
    const video         = document.getElementById('video');
    const loader        = document.getElementById('loader');
    const errorView     = document.getElementById('error-view');
    const errorText     = document.getElementById('error-text');
    const buffering     = document.getElementById('buffering');
    const playRipple    = document.getElementById('play-ripple');
    const rippleIcon    = document.getElementById('ripple-icon');
    const clickArea     = document.getElementById('click-area');
    const ppBtn         = document.getElementById('playpause-btn');
    const ppIcon        = document.getElementById('pp-icon');
    const muteBtn       = document.getElementById('mute-btn');
    const volIcon       = document.getElementById('vol-icon');
    const volSlider     = document.getElementById('volume-slider');
    const timeDisplay   = document.getElementById('time-display');
    const progressArea  = document.getElementById('progress-area');
    const progressFill  = document.getElementById('progress-fill');
    const progressBuf   = document.getElementById('progress-buffer');
    const settingsBtn   = document.getElementById('settings-btn');
    const settingsPanel = document.getElementById('settings-panel');
    const fsBtn         = document.getElementById('fullscreen-btn');
    const fsIcon        = document.getElementById('fs-icon');
    const menuQuality   = document.getElementById('menu-quality');
    const menuAudio     = document.getElementById('menu-audio');
    const qualityCurrent= document.getElementById('quality-current');
    const audioCurrent  = document.getElementById('audio-current');
    const panelMain     = document.getElementById('panel-main');
    const panelQuality  = document.getElementById('panel-quality');
    const panelAudio    = document.getElementById('panel-audio');
    const qualityList   = document.getElementById('quality-list');
    const audioList     = document.getElementById('audio-list');
    const backQuality   = document.getElementById('back-from-quality');
    const backAudio     = document.getElementById('back-from-audio');

    // ── Estado ─────────────────────────────────────────────────
    let hls             = null;
    let hideTimer       = null;
    let isSeeking       = false;

    // ── Iconos SVG ─────────────────────────────────────────────
    const ICON_PLAY    = '<path d="M8 5v14l11-7z"/>';
    const ICON_PAUSE   = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
    const ICON_VOL     = '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>';
    const ICON_MUTE    = '<path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>';
    const ICON_FS_ENTER= '<path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>';
    const ICON_FS_EXIT = '<path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/>';

    // ── Auto-ocultar controles ─────────────────────────────────
    function showControls() {
        wrap.classList.add('controls-visible');
        clearTimeout(hideTimer);
        if (!video.paused) {
            hideTimer = setTimeout(() => {
                if (!settingsPanel.classList.contains('open')) {
                    wrap.classList.remove('controls-visible');
                }
            }, 3000);
        }
    }

    wrap.addEventListener('mousemove', (e) => {
        if (window.matchMedia("(pointer: coarse)").matches) return;
        showControls();
    });
    wrap.addEventListener('touchstart', (e) => {
        if (e.target !== clickArea) showControls();
    }, { passive: true });

    // ── Formato de tiempo ──────────────────────────────────────
    function fmt(s) {
        if (!isFinite(s)) return '0:00';
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const ss = Math.floor(s % 60);
        if (h > 0) {
            return h + ':' + (m < 10 ? '0' : '') + m + ':' + (ss < 10 ? '0' : '') + ss;
        }
        return m + ':' + (ss < 10 ? '0' : '') + ss;
    }

    // ── Barra de progreso ──────────────────────────────────────
    video.addEventListener('timeupdate', () => {
        if (!video.duration || isSeeking) return;
        const pct = (video.currentTime / video.duration) * 100;
        progressFill.style.width = pct + '%';
        timeDisplay.textContent  = fmt(video.currentTime) + ' / ' + fmt(video.duration);
    });

    video.addEventListener('progress', () => {
        if (!video.duration) return;
        try {
            const buf = video.buffered;
            if (buf.length) {
                const pct = (buf.end(buf.length - 1) / video.duration) * 100;
                progressBuf.style.width = pct + '%';
            }
        } catch(e) {}
    });

    // Seek al hacer click en la barra
    function seekTo(e) {
        if (!video.duration) return;
        const rect = progressArea.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        video.currentTime = ratio * video.duration;
        progressFill.style.width = (ratio * 100) + '%';
    }

    progressArea.addEventListener('mousedown', (e) => {
        isSeeking = true;
        seekTo(e);
    });
    document.addEventListener('mousemove', (e) => { if (isSeeking) seekTo(e); });
    document.addEventListener('mouseup',   () => { isSeeking = false; });

    // ── Play / Pause ───────────────────────────────────────────
    function togglePlay() {
        if (video.paused) { video.play().catch(()=>{}); }
        else              { video.pause(); }
    }

    function showRipple(paused) {
        rippleIcon.innerHTML = paused ? ICON_PAUSE : ICON_PLAY;
        playRipple.classList.remove('hide');
        playRipple.classList.add('show');
        setTimeout(() => {
            playRipple.classList.remove('show');
            playRipple.classList.add('hide');
        }, 400);
    }

    clickArea.addEventListener('click', () => {
        const wasPaused = video.paused;
        togglePlay();
        showRipple(!wasPaused);
    });

    ppBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePlay();
    });

    video.addEventListener('play',  () => { ppIcon.innerHTML = ICON_PAUSE;  showControls(); });
    video.addEventListener('pause', () => { ppIcon.innerHTML = ICON_PLAY;   showControls(); });

    // ── Volumen ────────────────────────────────────────────────
    muteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        video.muted = !video.muted;
        syncVolIcon();
    });

    volSlider.addEventListener('input', (e) => {
        e.stopPropagation();
        video.volume = parseFloat(volSlider.value);
        video.muted  = video.volume === 0;
        syncVolIcon();
    });

    function syncVolIcon() {
        const val = (video.muted || video.volume === 0) ? 0 : video.volume;
        if (val === 0) {
            volIcon.innerHTML = ICON_MUTE;
            volSlider.value   = 0;
        } else {
            volIcon.innerHTML = ICON_VOL;
            volSlider.value   = val;
        }
        volSlider.style.background = 'linear-gradient(to right, #fff ' + (val * 100) + '%, rgba(255,255,255,0.3) ' + (val * 100) + '%)';
    }

    // ── Buffering ──────────────────────────────────────────────
    video.addEventListener('waiting',  () => buffering.classList.add('visible'));
    video.addEventListener('stalled',  () => buffering.classList.add('visible'));
    video.addEventListener('canplay',  () => buffering.classList.remove('visible'));
    video.addEventListener('playing',  () => buffering.classList.remove('visible'));

    // ── Fullscreen ─────────────────────────────────────────────
    fsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!document.fullscreenElement) {
            wrap.requestFullscreen().catch(()=>{});
        } else {
            document.exitFullscreen().catch(()=>{});
        }
    });

    document.addEventListener('fullscreenchange', () => {
        if (document.fullscreenElement) {
            fsIcon.innerHTML = ICON_FS_EXIT;
        } else {
            fsIcon.innerHTML = ICON_FS_ENTER;
        }
    });

    // ── Teclado ────────────────────────────────────────────────
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT') return;
        switch(e.code) {
            case 'Space': e.preventDefault(); togglePlay(); break;
            case 'KeyF':  fsBtn.click(); break;
            case 'KeyM':  muteBtn.click(); break;
            case 'ArrowRight': video.currentTime = Math.min(video.duration||0, video.currentTime + 5); break;
            case 'ArrowLeft':  video.currentTime = Math.max(0, video.currentTime - 5); break;
        }
    });

    // ── Panel de ajustes ───────────────────────────────────────
    function showPanel(view) {
        [panelMain, panelQuality, panelAudio].forEach(p => p.classList.add('hidden'));
        view.classList.remove('hidden');
    }

    settingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        settingsPanel.classList.toggle('open');
        if (settingsPanel.classList.contains('open')) {
            showPanel(panelMain);
            showControls();
        }
    });

    menuQuality.addEventListener('click', () => showPanel(panelQuality));
    menuAudio.addEventListener('click',   () => showPanel(panelAudio));
    backQuality.addEventListener('click', () => showPanel(panelMain));
    backAudio.addEventListener('click',   () => showPanel(panelMain));

    document.addEventListener('click', (e) => {
        if (!settingsPanel.contains(e.target) && e.target !== settingsBtn) {
            settingsPanel.classList.remove('open');
        }
    });

    // ── Construir lista de calidades ───────────────────────────
    function buildQualityUI() {
        if (!hls) return;
        qualityList.innerHTML = '';

        const autoItem = makeSubItem('Auto', hls.currentLevel === -1);
        autoItem.addEventListener('click', () => {
            hls.currentLevel = -1;
            qualityCurrent.textContent = 'Auto';
            setActiveSubItem(qualityList, autoItem);
            settingsPanel.classList.remove('open');
        });
        qualityList.appendChild(autoItem);

        hls.levels.forEach((lvl, i) => {
            const label = lvl.height ? lvl.height + 'p' : (lvl.name || 'Nivel ' + i);
            const item  = makeSubItem(label, hls.currentLevel === i);
            item.addEventListener('click', () => {
                hls.currentLevel = i;
                qualityCurrent.textContent = label;
                setActiveSubItem(qualityList, item);
                settingsPanel.classList.remove('open');
            });
            qualityList.appendChild(item);
        });
    }

    // ── Construir lista de idiomas ─────────────────────────────
    function buildAudioUI() {
        if (!hls || !hls.audioTracks || hls.audioTracks.length <= 1) return;
        audioList.innerHTML = '';
        menuAudio.style.display = 'flex';

        hls.audioTracks.forEach((t, i) => {
            const label = t.name || t.lang || 'Pista ' + (i + 1);
            const item  = makeSubItem(label, hls.audioTrack === i);
            item.addEventListener('click', () => {
                hls.audioTrack = i;
                audioCurrent.textContent = label;
                setActiveSubItem(audioList, item);
                settingsPanel.classList.remove('open');
            });
            audioList.appendChild(item);
        });

        // Mostrar pista activa actual
        const active = hls.audioTracks[hls.audioTrack];
        if (active) audioCurrent.textContent = active.name || active.lang || '—';
    }

    function makeSubItem(label, active) {
        const div = document.createElement('div');
        div.className = 'subpanel-item' + (active ? ' active' : '');
        div.innerHTML =
            '<div class="subpanel-dot"></div>' +
            '<span class="subpanel-text">' + label + '</span>';
        return div;
    }

    function setActiveSubItem(list, item) {
        list.querySelectorAll('.subpanel-item').forEach(el => el.classList.remove('active'));
        item.classList.add('active');
    }

    // ── Inicialización del reproductor ─────────────────────────
    function startStreaming(streamUrl, type) {
        if (type === 'm3u8' && Hls.isSupported()) {
            hls = new Hls({
                enableWorker:            true,
                progressive:             true,
                lowLatencyMode:          false,
                startLevel:              -1,
                abrEwmaDefaultEstimate:  300000,
                maxBufferLength:         20,
                maxMaxBufferLength:      60,
                maxBufferSize:           20 * 1024 * 1024,
                nudgeOffset:             0.1,
                nudgeMaxRetries:         10,
                fragLoadingMaxRetry:     6,
                manifestLoadingMaxRetry: 4,
                levelLoadingMaxRetry:    4,
            });
            hls.loadSource(streamUrl);
            hls.attachMedia(video);

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                buildQualityUI();
            });

            hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
                buildAudioUI();
            });

            hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
                if (hls.autoLevelEnabled) {
                    qualityCurrent.textContent = 'Auto';
                } else {
                    const lvl = hls.levels[data.level];
                    qualityCurrent.textContent = lvl && lvl.height ? lvl.height + 'p' : 'Nivel ' + data.level;
                }
            });

        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            // Safari nativo
            video.src = streamUrl;
        } else {
            video.src = streamUrl;
        }
    }

    // ── Flujo principal ────────────────────────────────────────
    async function init() {
        const originalUrl = "${encodeURIComponent(url)}";

        try {
            const minWait = new Promise(resolve => setTimeout(resolve, 9000));

            const data = await fetch('/play?url=' + originalUrl).then(r => r.json());
            if (data.error) throw new Error(data.error);

            let finalUrl = data.proxyUrl;

            // Si es un Data URI masivo (base64 m3u8), lo convertimos a un Blob Object URL 
            // manualmente para no saturar los límites de longitud de URL del navegador.
            if (finalUrl && finalUrl.startsWith('data:')) {
                try {
                    const parts = finalUrl.split(',');
                    const mimeMatch = parts[0].match(/:(.*?);/);
                    const mime = mimeMatch ? mimeMatch[1] : 'application/vnd.apple.mpegurl';
                    const b64Data = parts[1];
                    
                    const byteCharacters = atob(b64Data);
                    const byteNumbers = new Array(byteCharacters.length);
                    for (let i = 0; i < byteCharacters.length; i++) {
                        byteNumbers[i] = byteCharacters.charCodeAt(i);
                    }
                    const byteArray = new Uint8Array(byteNumbers);
                    const blob = new Blob([byteArray], { type: mime });
                    finalUrl = URL.createObjectURL(blob);
                } catch(e) {
                    console.error("Error decodificando Data URI a Blob", e);
                }
            }

            // Arrancar streaming en segundo plano (muted) mientras el loader está visible
            startStreaming(finalUrl, data.type);

            // Esperar los 9 segundos mínimos
            await minWait;

            // Fade out del loader y mostrar video
            loader.classList.add('hidden');
            setTimeout(() => { loader.style.display = 'none'; }, 600);

            buffering.classList.remove('visible');
            showControls();

        } catch (err) {
            loader.style.display = 'none';
            errorView.style.display = 'flex';
            errorText.textContent  = err.message || 'No se pudo cargar el video.';
        }
    }

    init();

})();
</script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);

  } catch (err) {
    next(err);
  }
}

module.exports = { embedHandler };
