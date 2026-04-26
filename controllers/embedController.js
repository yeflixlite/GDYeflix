/**
 * ============================================================
 *  controllers/embedController.js
 *  Servidor de reproductor minimalista (Embed) para compartir.
 *  Diseño Premium · Soporte Auto-Extraíble
 * ============================================================
 */

'use strict';

/**
 * Renderiza una página HTML optimizada para embeds (sin menús, solo video).
 */
async function embedHandler(req, res, next) {
  try {
    const { url } = req.query;

    if (!url) {
      return res.status(400).send('Error: Falta el parámetro ?url= en el embed.');
    }

    const html = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Proxy Yeflix · Embed</title>
    <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;700&display=swap" rel="stylesheet">
    <style>
        body, html { 
            margin: 0; padding: 0; width: 100%; height: 100%; 
            background: #000; overflow: hidden; 
            font-family: 'Outfit', sans-serif;
        }
        #container { position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
        video { width: 100%; height: 100%; outline: none; background: #000; }
        
        /* Overlay de carga estilo Netflix */
        #loader {
            position: absolute; inset: 0; z-index: 100;
            background: #000; display: flex; flex-direction: column;
            align-items: center; justify-content: center; color: #fff;
            transition: opacity 0.5s;
        }
        .logo-yeflix {
            font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
            color: #E50914; /* Rojo Netflix */
            font-size: 42px;
            font-weight: 900;
            letter-spacing: 2px;
            margin-bottom: 30px;
            text-transform: uppercase;
            transform: scaleY(1.1); /* Efecto condensado estilo Netflix */
        }
        .netflix-spinner {
            width: 60px; height: 60px;
            border: 4px solid rgba(229, 9, 20, 0.2);
            border-top: 4px solid #E50914;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .wait-text {
            color: #888;
            font-size: 13px;
            margin-top: 20px;
            font-weight: 500;
            letter-spacing: 0.5px;
        }
        
        /* Menú de calidad flotante */
        #menu {
            position: absolute; top: 15px; right: 15px; z-index: 1000;
            background: rgba(0, 0, 0, 0.7); backdrop-filter: blur(10px);
            border: 1px solid rgba(255,255,255,0.1); border-radius: 5px;
            padding: 8px; display: none; flex-direction: column; gap: 5px;
        }
        select { 
            background: transparent; color: #fff; border: none; 
            border-radius: 3px; padding: 5px; font-size: 13px; 
            cursor: pointer; outline: none; font-family: inherit;
            font-weight: bold;
        }
        select option { background: #111; color: #fff; }
        .error-msg { color: #E50914; font-size: 16px; text-align: center; padding: 20px; display: none; }
    </style>
</head>
<body>
    <div id="container">
        <div id="loader">
            <div class="logo-yeflix">YEFLIX</div>
            <div class="netflix-spinner"></div>
            <div class="wait-text">Cargando video...</div>
        </div>
        
        <div id="menu">
            <select id="qualitySelect"><option>Cargando...</option></select>
            <select id="audioSelect" style="display:none"></select>
        </div>

        <div id="error" class="error-msg"></div>
        <video id="player" controls playsinline crossorigin="anonymous"></video>
    </div>

    <script>
        let hls = null;
        const video = document.getElementById('player');
        const loader = document.getElementById('loader');
        const errorView = document.getElementById('error');

        async function init() {
            const originalUrl = "${encodeURIComponent(url)}";
            
            try {
                const minWait = new Promise(resolve => setTimeout(resolve, 4000));
                const data = await fetch('/play?url=' + originalUrl).then(r => r.json());
                
                if (data.error) throw new Error(data.error);
                
                // Empezamos a cargar el video en segundo plano
                startStreaming(data.proxyUrl, data.type, false);

                // Esperamos los 4 segundos totales
                await minWait;

                // Mostramos el video
                loader.style.opacity = '0';
                setTimeout(() => loader.style.display = 'none', 500);
                video.style.display = 'block';

            } catch (err) {
                loader.style.display = 'none';
                errorView.style.display = 'block';
                errorView.textContent = "Error: " + err.message;
            }
        }

        function startStreaming(url, type, showImmediately = true) {
            if (showImmediately) {
                loader.style.opacity = '0';
                setTimeout(() => loader.style.display = 'none', 500);
                video.style.display = 'block';
            } else {
                video.style.display = 'none';
            }

            if (type === 'm3u8' && Hls.isSupported()) {
                hls = new Hls({ 
                    enableWorker: true,
                    maxBufferLength: 60,
                    maxMaxBufferLength: 120,
                    maxBufferSize: 60 * 1024 * 1024,
                    nudgeOffset: 0.1,
                    nudgeMaxRetries: 5
                });
                hls.loadSource(url);
                hls.attachMedia(video);
                hls.on(Hls.Events.MANIFEST_PARSED, setupUI);
                hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, updateAudioUI);
            } else {
                video.src = url;
            }
            video.play().catch(() => {});
        }

        function setupUI() {
            const menu = document.getElementById('menu');
            const q = document.getElementById('qualitySelect');
            const a = document.getElementById('audioSelect');

            if (!hls) return;

            // Calidades
            q.innerHTML = '<option value="-1">Calidad: Auto</option>';
            hls.levels.forEach((l, i) => {
                const opt = document.createElement('option');
                opt.value = i;
                let label = 'Nivel ' + i;
                if (l.height && l.height > 0) label = l.height + 'p';
                else if (l.name) label = l.name;
                opt.textContent = label;
                q.appendChild(opt);
            });
            q.onchange = () => (hls.currentLevel = parseInt(q.value));

            // Audios (a veces no están listos en MANIFEST_PARSED, por eso revisamos)
            updateAudioUI();
            
            menu.style.display = 'flex';
        }

        function updateAudioUI() {
            const a = document.getElementById('audioSelect');
            if (!hls || !hls.audioTracks || hls.audioTracks.length <= 1) return;
            
            a.style.display = 'block';
            a.innerHTML = '';
            hls.audioTracks.forEach((t, i) => {
                const opt = document.createElement('option');
                opt.value = i;
                opt.textContent = t.name || t.lang || 'Audio ' + i;
                a.appendChild(opt);
            });
            a.onchange = () => (hls.audioTrack = parseInt(a.value));
        }

        init();
    </script>
</body>
</html>
    `;

    res.header('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    next(err);
  }
}

module.exports = { embedHandler };
