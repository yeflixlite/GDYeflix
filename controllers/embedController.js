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
        
        /* Overlay de carga */
        #loader {
            position: absolute; inset: 0; z-index: 100;
            background: #05060a; display: flex; flex-direction: column;
            align-items: center; justify-content: center; color: #fff;
            transition: opacity 0.5s;
        }
        .spinner {
            width: 40px; height: 40px; border: 3px solid rgba(255,255,255,0.1);
            border-top: 3px solid #6366f1; border-radius: 50%;
            animation: spin 0.8s linear infinite; margin-bottom: 15px;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        
        /* Menú de calidad flotante */
        #menu {
            position: absolute; top: 15px; right: 15px; z-index: 1000;
            background: rgba(13, 15, 23, 0.85); backdrop-filter: blur(10px);
            border: 1px solid rgba(255,255,255,0.1); border-radius: 10px;
            padding: 8px; display: none; flex-direction: column; gap: 5px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.5);
        }
        select { 
            background: #1a1d2d; color: #fff; border: none; 
            border-radius: 5px; padding: 5px 10px; font-size: 12px; 
            cursor: pointer; outline: none; font-family: inherit;
        }
        .error-msg { color: #ef4444; font-size: 14px; text-align: center; padding: 20px; display: none; }
    </style>
</head>
<body>
    <div id="container">
        <div id="loader">
            <div class="spinner"></div>
            <div style="font-size: 13px; font-weight: 400; color: #94a3b8;">Sincronizando stream seguro...</div>
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
                // Usamos el endpoint /play que ahora es robusto
                const res = await fetch('/play?url=' + originalUrl);
                const data = await res.json();
                
                if (data.error) throw new Error(data.error);
                
                startStreaming(data.proxyUrl, data.type);
            } catch (err) {
                loader.style.display = 'none';
                errorView.style.display = 'block';
                errorView.textContent = "Error: " + err.message;
            }
        }

        function startStreaming(url, type) {
            loader.style.opacity = '0';
            setTimeout(() => loader.style.display = 'none', 500);

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

            // Audios
            if (hls.audioTracks.length > 1) {
                a.style.display = 'block';
                hls.audioTracks.forEach((t, i) => {
                    const opt = document.createElement('option');
                    opt.value = i;
                    opt.textContent = t.name || t.lang || 'Audio ' + i;
                    a.appendChild(opt);
                });
                a.onchange = () => (hls.audioTrack = parseInt(a.value));
            }

            menu.style.display = 'flex';
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
