/**
 * ============================================================
 *  controllers/embedController.js
 *  Servidor de reproductor minimalista (Embed)
 * ============================================================
 */

'use strict';

const { detectProvider } = require('../utils/urlDetector');

/**
 * Renderiza una página HTML simple con HLS.js configurado.
 */
async function embedHandler(req, res, next) {
  try {
    const { url } = req.query;

    if (!url) {
      return res.status(400).send('Error: Falta el parámetro ?url=');
    }

    const html = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>VideoProxy Player · Embed</title>
    <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
    <style>
        body, html { margin: 0; padding: 0; width: 100%; height: 100%; background: #000; overflow: hidden; display: flex; align-items: center; justify-content: center; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
        video { width: 100%; height: 100%; outline: none; }
        #status { color: #8b85ff; font-size: 14px; position: absolute; z-index: 10000; background: rgba(0,0,0,0.8); padding: 12px 24px; border-radius: 99px; border: 1px solid rgba(255,255,255,0.1); }
        
        /* Controles flotantes - Ahora mas visibles y siempre arriba */
        .controls { position: absolute; top: 15px; right: 15px; display: none; flex-direction: column; gap: 8px; z-index: 99999; pointer-events: none; }
        .control-group { 
            background: rgba(15,15,20,0.9); 
            border: 1px solid #6c63ff; 
            border-radius: 10px; 
            padding: 8px 12px; 
            display: flex; 
            flex-direction: column; 
            gap: 4px; 
            backdrop-filter: blur(10px); 
            pointer-events: auto;
            box-shadow: 0 4px 15px rgba(0,0,0,0.5);
        }
        .control-group label { font-size: 10px; color: #6c63ff; text-transform: uppercase; font-weight: 800; letter-spacing: 1px; }
        .control-group select { background: transparent; color: #fff; border: none; font-size: 13px; outline: none; cursor: pointer; padding: 2px 0; width: 120px; }
        .control-group select option { background: #1a1a20; color: #fff; }
        
        .toast { position: absolute; bottom: 30px; left: 50%; transform: translateX(-50%); background: #6c63ff; color: white; padding: 10px 20px; border-radius: 99px; font-size: 13px; font-weight: 600; opacity: 0; transition: opacity 0.3s; pointer-events: none; z-index: 100000; box-shadow: 0 4px 15px rgba(108, 99, 255, 0.4); }
    </style>
</head>
<body>
    <div id="status">⏳ Extrayendo video seguro...</div>
    <div id="toast" class="toast">Cambiando...</div>
    
    <div class="controls" id="playerControls">
        <div class="control-group">
            <label>Resolución</label>
            <select id="qualitySelect"><option>Cargando...</option></select>
        </div>
        <div class="control-group" id="audioGroup">
            <label>Idioma / Audio</label>
            <select id="audioSelect"><option>Cargando...</option></select>
        </div>
    </div>

    <video id="player" controls playsinline crossorigin="anonymous"></video>

    <script>
        let hlsObj = null;

        function showToast(msg) {
            const t = document.getElementById('toast');
            t.textContent = msg;
            t.style.opacity = '1';
            setTimeout(() => t.style.opacity = '0', 2000);
        }

        async function start() {
            const status = document.getElementById('status');
            const video = document.getElementById('player');
            const originalUrl = "${encodeURIComponent(url)}";
            
            try {
                const res = await fetch('/extract?url=' + originalUrl);
                const data = await res.json();
                if (!data.ok) throw new Error(data.error);
                
                status.style.display = 'none';
                const streamUrl = data.proxyUrl;

                if (Hls.isSupported()) {
                    hlsObj = new Hls({ 
                        enableWorker: true,
                        autoStartLoad: true,
                        maxBufferLength: 60, // 60 segundos de buffer
                        maxMaxBufferLength: 120
                    });
                    hlsObj.loadSource(streamUrl);
                    hlsObj.attachMedia(video);
                    
                    hlsObj.on(Hls.Events.MANIFEST_PARSED, () => {
                        setupUI();
                        video.play().catch(() => {});
                    });
                    
                    // Actualizar cuando cambie el nivel o track para refrescar UI
                    hlsObj.on(Hls.Events.LEVEL_SWITCHED, setupUI);
                    hlsObj.on(Hls.Events.AUDIO_TRACK_SWITCHED, setupUI);

                } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                    video.src = streamUrl;
                    video.play().catch(() => {});
                }
            } catch (err) {
                status.style.background = '#f43f5e';
                status.style.color = 'white';
                status.textContent = '❌ Error: ' + err.message;
            }
        }

        function setupUI() {
            if (!hlsObj) return;
            const q = document.getElementById('qualitySelect');
            const a = document.getElementById('audioSelect');
            const ctrl = document.getElementById('playerControls');
            const aGroup = document.getElementById('audioGroup');

            // Siempre mostramos el contenedor si es HLS
            ctrl.style.display = 'flex';

            // ── Configurar Calidad ──
            const currentLevel = hlsObj.currentLevel;
            q.innerHTML = '<option value="-1"' + (currentLevel === -1 ? ' selected' : '') + '>Auto (Adaptativo)</option>';
            hlsObj.levels.forEach((lv, i) => {
                const opt = document.createElement('option');
                opt.value = i;
                opt.selected = (i === currentLevel);
                opt.textContent = lv.height ? lv.height + "p" : "Calidad " + (i+1);
                q.appendChild(opt);
            });
            q.onchange = () => {
                hlsObj.currentLevel = parseInt(q.value);
                showToast('Ajustando resolución...');
            }

            // ── Configurar Audio ──
            if (hlsObj.audioTracks && hlsObj.audioTracks.length > 0) {
                const currentTrack = hlsObj.audioTrack;
                a.innerHTML = '';
                hlsObj.audioTracks.forEach((t, i) => {
                    const opt = document.createElement('option');
                    opt.value = i;
                    opt.selected = (i === currentTrack);
                    opt.textContent = t.name || t.lang || "Audio " + (i+1);
                    a.appendChild(opt);
                });
                a.onchange = () => {
                    hlsObj.audioTrack = parseInt(a.value);
                    showToast('Cambiando idioma...');
                }
                aGroup.style.display = 'flex';
            } else {
                aGroup.style.display = 'none';
            }
        }

        start();
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
