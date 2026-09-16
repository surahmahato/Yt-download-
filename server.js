const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { createDecipheriv } = require('crypto');
const axios = require('axios');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.apk': 'application/vnd.android.package-archive'
};

// Normalize video URL to standard YouTube watch link
function normalizeVideoUrl(inputUrl) {
  if (!inputUrl) return '';
  const trimmed = inputUrl.trim();

  // Match shorts: /shorts/ID
  const shortsMatch = trimmed.match(/\/shorts\/([a-zA-Z0-9_-]{11})/i);
  if (shortsMatch && shortsMatch[1]) {
    return `https://www.youtube.com/watch?v=${shortsMatch[1]}`;
  }

  // Match youtu.be/ID
  const youtuMatch = trimmed.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/i);
  if (youtuMatch && youtuMatch[1]) {
    return `https://www.youtube.com/watch?v=${youtuMatch[1]}`;
  }

  // Match standard watch?v=ID
  const watchMatch = trimmed.match(/[?&]v=([a-zA-Z0-9_-]{11})/i);
  if (watchMatch && watchMatch[1]) {
    return `https://www.youtube.com/watch?v=${watchMatch[1]}`;
  }

  return trimmed;
}

// Savetube Decryption
function decodeSavetubeData(enc) {
  try {
    const secretKey = 'C5D58EF67A7584E4A29F6C35BBC4EB12';
    const data = Buffer.from(enc, 'base64');
    const iv = data.slice(0, 16);
    const content = data.slice(16);
    const key = Buffer.from(secretKey, 'hex');
    const decipher = createDecipheriv('aes-128-cbc', key, iv);
    const decrypted = Buffer.concat([decipher.update(content), decipher.final()]);
    return JSON.parse(decrypted.toString());
  } catch (err) {
    throw new Error(`Savetube decryption error: ${err.message}`);
  }
}

// Fetch Video Information and Available Download Streams
async function fetchVideoInfo(rawUrl) {
  const normalizedUrl = normalizeVideoUrl(rawUrl);

  const cdnRes = await axios.get('https://media.savetube.vip/api/random-cdn', {
    timeout: 8000
  });
  const cdn = cdnRes.data && cdnRes.data.cdn ? cdnRes.data.cdn : 'cdn403.savetube.vip';

  const infoRes = await axios.post(`https://${cdn}/v2/info`, {
    url: normalizedUrl
  }, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36',
      'Referer': 'https://save-tube.com/'
    },
    timeout: 10000
  });

  if (!infoRes.data || !infoRes.data.data) {
    throw new Error('Video metadata not found or video is private/unavailable');
  }

  const info = decodeSavetubeData(infoRes.data.data);
  return { info, cdn, normalizedUrl };
}

// Resolve specific format download URL
async function resolveDownloadStream(rawUrl, quality, type) {
  const { info, cdn, normalizedUrl } = await fetchVideoInfo(rawUrl);
  const qualityStr = String(quality || (type === 'audio' ? '128' : '720'));

  // If video and format already has a direct Google CDN stream URL
  if (type === 'video' && Array.isArray(info.video_formats)) {
    const directMatch = info.video_formats.find(
      f => String(f.quality) === qualityStr && f.url && f.url.startsWith('http')
    );
    if (directMatch && directMatch.url) {
      const cleanTitle = (info.title || 'video').replace(/[^a-zA-Z0-9_\-\s]/g, '').trim().replace(/\s+/g, '_');
      return {
        success: true,
        downloadUrl: directMatch.url,
        filename: `${cleanTitle}_${qualityStr}p.mp4`,
        title: info.title,
        duration: info.durationLabel || `${Math.floor(info.duration / 60)}:${(info.duration % 60).toString().padStart(2, '0')}`,
        thumbnail: info.thumbnail,
        quality: `${qualityStr}p`,
        type: 'video'
      };
    }
  }

  // Request merged HD stream from Savetube CDN
  const dlRes = await axios.post(`https://${cdn}/download`, {
    downloadType: type === 'audio' ? 'audio' : 'video',
    quality: qualityStr,
    key: info.key
  }, {
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36',
      'Referer': 'https://save-tube.com/'
    },
    timeout: 15000
  });

  if (dlRes.data && dlRes.data.data && dlRes.data.data.downloadUrl) {
    const cleanTitle = (info.title || 'video').replace(/[^a-zA-Z0-9_\-\s]/g, '').trim().replace(/\s+/g, '_');
    const ext = type === 'audio' ? 'mp3' : 'mp4';
    return {
      success: true,
      downloadUrl: dlRes.data.data.downloadUrl,
      filename: `${cleanTitle}_${qualityStr}${type === 'audio' ? 'kbps' : 'p'}.${ext}`,
      title: info.title,
      duration: info.durationLabel || `${Math.floor(info.duration / 60)}:${(info.duration % 60).toString().padStart(2, '0')}`,
      thumbnail: info.thumbnail,
      quality: `${qualityStr}${type === 'audio' ? 'kbps' : 'p'}`,
      type: type
    };
  }

  throw new Error('CDN stream could not be generated for this quality');
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  let reqPath = parsedUrl.pathname;
  if (reqPath === '/') {
    reqPath = '/index.html';
  }

  // Health check endpoint for Render
  if (reqPath === '/healthz' || reqPath === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
    return;
  }

  // API: Analyze Video - Returns real title, thumb, duration, and list of available format downloads
  if (reqPath === '/api/analyze') {
    const videoUrl = parsedUrl.query.url;
    if (!videoUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: false, error: 'Missing url parameter' }));
      return;
    }

    try {
      const { info, normalizedUrl } = await fetchVideoInfo(videoUrl);

      // Extract available formats
      const availableQualities = [
        { quality: '1080', label: '1080p (Full HD)', type: 'video', ext: 'mp4', badge: 'Full HD' },
        { quality: '720', label: '720p (HD)', type: 'video', ext: 'mp4', badge: 'HD' },
        { quality: '480', label: '480p (Standard)', type: 'video', ext: 'mp4', badge: 'SD' },
        { quality: '360', label: '360p (Fast Download)', type: 'video', ext: 'mp4', badge: 'Mobile' },
        { quality: '320', label: 'MP3 Audio (320 kbps)', type: 'audio', ext: 'mp3', badge: 'MP3 HQ' },
        { quality: '128', label: 'MP3 Audio (128 kbps)', type: 'audio', ext: 'mp3', badge: 'MP3' }
      ];

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({
        success: true,
        id: info.id,
        title: info.title,
        thumbnail: info.thumbnail,
        duration: info.durationLabel || `${Math.floor(info.duration / 60)}:${(info.duration % 60).toString().padStart(2, '0')}`,
        normalizedUrl: normalizedUrl,
        formats: availableQualities
      }));
      return;
    } catch (err) {
      console.error('Analyze error:', err.message);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({
        success: false,
        error: err.message || 'Unable to parse video stream'
      }));
      return;
    }
  }

  // API: Resolve real direct download stream
  if (reqPath === '/api/resolve' || reqPath === '/api/get-download-url') {
    const videoUrl = parsedUrl.query.url;
    const quality = parsedUrl.query.quality || '720';
    const type = parsedUrl.query.type || 'video';

    if (!videoUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: false, error: 'Missing url parameter' }));
      return;
    }

    try {
      const streamInfo = await resolveDownloadStream(videoUrl, quality, type);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify(streamInfo));
      return;
    } catch (err) {
      console.error('Resolve error:', err.message);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({
        success: false,
        error: err.message
      }));
      return;
    }
  }

  // API: Direct proxy stream - Guarantees Content-Disposition attachment for mobile phones
  if (reqPath === '/api/proxy-download') {
    const targetUrl = parsedUrl.query.url;
    const filename = parsedUrl.query.filename || 'video.mp4';

    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing url');
      return;
    }

    try {
      const client = targetUrl.startsWith('https') ? https : http;
      client.get(targetUrl, (streamRes) => {
        if (streamRes.statusCode >= 300 && streamRes.statusCode < 400 && streamRes.headers.location) {
          const redirUrl = streamRes.headers.location;
          const redirClient = redirUrl.startsWith('https') ? https : http;
          redirClient.get(redirUrl, (finalRes) => {
            const ext = path.extname(filename).toLowerCase();
            const contentType = MIME_TYPES[ext] || 'video/mp4';
            res.writeHead(200, {
              'Content-Type': contentType,
              'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
              'Access-Control-Allow-Origin': '*'
            });
            finalRes.pipe(res);
          }).on('error', () => {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Redirect proxy error');
          });
          return;
        }

        const ext = path.extname(filename).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'video/mp4';
        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
          'Access-Control-Allow-Origin': '*'
        });
        streamRes.pipe(res);
      }).on('error', (e) => {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Proxy stream error: ${e.message}`);
      });
      return;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Proxy exception: ${err.message}`);
      return;
    }
  }

  // Static files handling
  let filePath = path.join(PUBLIC_DIR, reqPath);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(__dirname, reqPath);
  }

  const resolvedPath = path.resolve(filePath);
  if (!resolvedPath.startsWith(__dirname)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  fs.stat(resolvedPath, (err, stats) => {
    if (err || !stats.isFile()) {
      const indexPath = path.join(PUBLIC_DIR, 'index.html');
      fs.readFile(indexPath, (readErr, content) => {
        if (readErr) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('404 Not Found');
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(content);
        }
      });
      return;
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const headers = {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600'
    };

    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    if (urlObj.searchParams.get('download') === '1' || ext === '.apk') {
      const downloadFilename = urlObj.searchParams.get('filename') || path.basename(resolvedPath);
      headers['Content-Disposition'] = `attachment; filename="${downloadFilename}"`;
    }

    res.writeHead(200, headers);
    const stream = fs.createReadStream(resolvedPath);
    stream.pipe(res);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`YT Download Web server running live on port ${PORT}`);
});
