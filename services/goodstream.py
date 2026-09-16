#!/usr/bin/env python3
"""
Goodstream Ad & VAST Stripper / Extractor
Removes dynamic VAST tags, ad scripts, popup triggers, and extracts clean video streams.
"""

import sys
import re
import json
import urllib.request
import urllib.parse
from html import unescape


def clean_goodstream_js(js_code: str) -> dict:
    """
    Parses Goodstream player script (from goodstream.txt or embed HTML)
    and removes all VAST ads, popups, tracking, and video_ad elements.
    Returns clean video data dictionary.
    """
    data = {
        "sources": [],
        "image": "",
        "tracks": [],
        "duration": 0,
        "qualityLabels": {},
        "captions": {},
        "raw_clean_setup": {}
    }

    # 1. Extract sources: [{file: "..."}] or sources: [...]
    sources_match = re.search(r'sources\s*:\s*(\[\s*\{.*?\}\s*\])', js_code, re.DOTALL)
    if sources_match:
        try:
            # Fix unquoted keys if necessary for JSON parsing
            raw_sources = sources_match.group(1)
            # Find all file urls
            files = re.findall(r'file\s*:\s*["\']([^"\']+)["\']', raw_sources)
            data["sources"] = [{"file": f, "type": "application/x-mpegURL" if ".m3u8" in f else "video/mp4"} for f in files]
        except Exception:
            pass

    if not data["sources"]:
        # Fallback regex for single stream
        single_m3u8 = re.search(r'["\']?(https?://[^"\'\s]+\.m3u8[^"\'\s]*)["\']?', js_code)
        if single_m3u8:
            data["sources"] = [{"file": single_m3u8.group(1), "type": "application/x-mpegURL"}]

    # 2. Extract image poster
    image_match = re.search(r'image\s*:\s*["\']([^"\']+)["\']', js_code)
    if image_match:
        data["image"] = image_match.group(1)

    # 3. Extract duration
    dur_match = re.search(r'duration\s*:\s*["\']?([0-9\.]+)["\']?', js_code)
    if dur_match:
        try:
            data["duration"] = float(dur_match.group(1))
        except ValueError:
            data["duration"] = 0

    # 4. Extract tracks (VTT Subtitles and Thumbnails)
    tracks_match = re.search(r'tracks\s*:\s*(\[\s*\{.*?\}\s*\])', js_code, re.DOTALL)
    if tracks_match:
        raw_tracks = tracks_match.group(1)
        # Parse individual track objects
        track_items = re.findall(r'\{([^{}]+)\}', raw_tracks)
        for item in track_items:
            file_m = re.search(r'file\s*:\s*["\']([^"\']+)["\']', item)
            kind_m = re.search(r'kind\s*:\s*["\']([^"\']+)["\']', item)
            label_m = re.search(r'label\s*:\s*["\']([^"\']+)["\']', item)
            default_m = re.search(r'["\']?default["\']?\s*:\s*(true|false)', item)

            if file_m:
                track_dict = {
                    "file": file_m.group(1),
                    "kind": kind_m.group(1) if kind_m else "captions",
                }
                if label_m:
                    track_dict["label"] = label_m.group(1)
                if default_m and default_m.group(1) == "true":
                    track_dict["default"] = True
                data["tracks"].append(track_dict)

    # 5. Extract Quality Labels
    ql_match = re.search(r'["\']?qualityLabels["\']?\s*:\s*(\{[^}]+\})', js_code)
    if ql_match:
        try:
            raw_ql = ql_match.group(1)
            # convert { "969":"720p", ... } to dict
            labels = dict(re.findall(r'["\']?(\d+)["\']?\s*:\s*["\']([^"\']+)["\']', raw_ql))
            data["qualityLabels"] = labels
        except Exception:
            pass

    return data


def strip_vast_and_ads_from_html(html_content: str) -> str:
    """
    Removes:
    - VAST ad tags (<advertising>, "advertising": {...}, jwplayer().loadAdTag)
    - Dynamic ad scripts, popup loaders, Cloudflare rocket scripts
    - Video ad overlay containers ($('div.video_ad_fadein'), $('div.video_ad'))
    - Malicious popups & window.open hijackers
    """
    # Remove dynamic advertising object from JWPlayer setup
    cleaned = re.sub(r'["\']?advertising["\']?\s*:\s*\{[^}]*\},?', '', html_content)

    # Remove loadAdTag calls
    cleaned = re.sub(r'jwplayer\(\)\.loadAdTag\([^)]+\);?', '', cleaned)

    # Remove video_ad fadeIn and show handlers
    cleaned = re.sub(r'\$\([\'"]div\.video_ad[^\'"]*[\'"]\)\.[a-zA-Z]+\([^)]*\);?', '', cleaned)

    # Remove vvad / vastdone ad variables and conditions
    cleaned = re.sub(r'if\s*\([^)]*vvad[^)]*\)\s*\{[^}]*\}', '', cleaned)
    cleaned = re.sub(r'if\s*\([^)]*vastdone[^)]*\)\s*\{[^}]*\}', '', cleaned)

    # Remove known ad network domains and VAST XML URLs
    cleaned = re.sub(r'https?://[^\s"\'<>]+\.xml[^\s"\'<>]*', '', cleaned)
    cleaned = re.sub(r'https?://[^\s"\'<>]*(?:agl003|popads|propeller|adsterra|alwingulla|highperformancegate)[^\s"\'<>]*', '', cleaned)

    return cleaned


def fetch_and_clean_embed(url: str) -> dict:
    """
    Fetches the embed URL from Goodstream and parses clean stream data.
    """
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Referer": "https://goodstream.one/",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }

    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=15) as response:
            html = response.read().decode("utf-8", errors="ignore")
    except Exception as e:
        return {"error": f"Failed to fetch embed: {str(e)}"}

    cleaned_html = strip_vast_and_ads_from_html(html)
    video_data = clean_goodstream_js(cleaned_html)
    video_data["url"] = url
    return video_data


def generate_clean_player_html(data: dict) -> str:
    """
    Generates a high-performance, ad-free standalone HTML5 player.
    Supports HLS stream with quality selector, subtitles, and thumbnails without ANY ads.
    """
    sources_json = json.dumps(data.get("sources", []))
    tracks_json = json.dumps(data.get("tracks", []))
    image = data.get("image", "")
    m3u8_file = data["sources"][0]["file"] if data.get("sources") else ""

    subtitles_html = ""
    for t in data.get("tracks", []):
        if t.get("kind") == "captions":
            default_attr = "default" if t.get("default") else ""
            subtitles_html += f'<track label="{t.get("label", "Subtitles")}" kind="subtitles" srclang="es" src="{t.get("file")}" {default_attr}>\n'

    return f"""<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Goodstream Clean Player (No Ads / No VAST)</title>
  <link rel="stylesheet" href="https://cdn.plyr.io/3.7.8/plyr.css" />
  <style>
    * {{ margin: 0; padding: 0; box-sizing: border-box; }}
    html, body {{
      width: 100%;
      height: 100%;
      background-color: #000;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }}
    .player-wrapper {{
      width: 100%;
      height: 100%;
      max-width: 100vw;
      max-height: 100vh;
      position: relative;
    }}
    video {{
      width: 100%;
      height: 100%;
      object-fit: contain;
    }}
    /* Anti-AdBlocker / Anti-Popup Shield */
    .ad-shield {{ display: none !important; }}
  </style>
  <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
  <script src="https://cdn.plyr.io/3.7.8/plyr.polyfilled.js"></script>
  <script>
    // Neutralize any dynamic popups, alert hijacking, or VAST loaders
    window.open = function() {{ console.log("[Protected] Blocked popup attempt."); return null; }};
    window.alert = function() {{ console.log("[Protected] Alert suppressed."); }};
  </script>
</head>
<body>
  <div class="player-wrapper">
    <video id="player" playsinline controls poster="{image}">
      {subtitles_html}
    </video>
  </div>

  <script>
    document.addEventListener('DOMContentLoaded', () => {{
      const video = document.getElementById('player');
      const source = "{m3u8_file}";

      if (!source) {{
        console.error("No valid video source found.");
        return;
      }}

      // Initialize Plyr UI with clean controls
      const defaultOptions = {{
        controls: [
          'play-large', 'play', 'progress', 'current-time', 'duration',
          'mute', 'volume', 'captions', 'settings', 'pip', 'airplay', 'fullscreen'
        ],
        settings: ['captions', 'quality', 'speed'],
        speed: {{ selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2] }},
        keyboard: {{ focused: true, global: true }}
      }};

      if (Hls.isSupported() && source.includes('.m3u8')) {{
        const hls = new Hls({{
          capLevelToPlayerSize: true,
          autoStartLoad: true
        }});
        hls.loadSource(source);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, function (event, data) {{
          const availableQualities = hls.levels.map((l) => l.height);
          availableQualities.unshift(0); // Auto quality option

          defaultOptions.quality = {{
            default: 0,
            options: availableQualities,
            forced: true,
            onChange: (e) => updateQuality(e),
          }};

          defaultOptions.i18n = {{
            qualityLabel: {{ 0: 'Auto' }}
          }};

          new Plyr(video, defaultOptions);
        }});

        function updateQuality(newQuality) {{
          if (newQuality === 0) {{
            hls.currentLevel = -1; // Auto
          }} else {{
            hls.levels.forEach((level, levelIndex) => {{
              if (level.height === newQuality) {{
                hls.currentLevel = levelIndex;
              }}
            }});
          }}
        }}
      }} else if (video.canPlayType('application/vnd.apple.mpegurl')) {{
        video.src = source;
        new Plyr(video, defaultOptions);
      }} else {{
        video.src = source;
        new Plyr(video, defaultOptions);
      }}
    }});
  </script>
</body>
</html>"""


if __name__ == "__main__":
    # Test with command line argument or goodstream.txt
    target_url = sys.argv[1] if len(sys.argv) > 1 else None

    if target_url and target_url.startswith("http"):
        print(f"[*] Fetching and stripping ads from {target_url}...")
        result = fetch_and_clean_embed(target_url)
    else:
        # Read from goodstream.txt if available
        try:
            with open("goodstream.txt", "r", encoding="utf-8") as f:
                content = f.read()
            print("[*] Processing goodstream.txt...")
            cleaned = strip_vast_and_ads_from_html(content)
            result = clean_goodstream_js(cleaned)
        except Exception as e:
            result = {"error": f"Could not read goodstream.txt: {str(e)}"}

    print(json.dumps(result, indent=2))
