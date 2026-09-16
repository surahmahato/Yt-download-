const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

let ytmp4, ytmp3;
try {
  const scraper = require('@vreden/youtube_scraper');
  ytmp4 = scraper.ytmp4;
  ytmp3 = scraper.ytmp3;
} catch (e) {
  console.warn('Scraper module load warning:', e.message);
}

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

const server = http.createServer(async (req, res) => {
  // Normalize URL
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

  // API: Resolve real video direct download URL
  if (reqPath === '/api/resolve') {
    const videoUrl = parsedUrl.query.url;
    const quality = parsedUrl.query.quality || '720';
    const type = parsedUrl.query.type || 'video';

    if (!videoUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Missing url parameter' }));
      return;
    }

    try {
      let qualityNum = parseInt(quality, 10);
      if (isNaN(qualityNum)) qualityNum = 720;

      let result;
      if (type === 'audio' && ytmp3) {
        result = await ytmp3(videoUrl, qualityNum || 128);
      } else if (ytmp4) {
        result = await ytmp4(videoUrl, qualityNum);
      }

      if (result && result.status && result.download && result.download.url) {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({
          success: true,
          downloadUrl: result.download.url,
          filename: result.download.filename,
          quality: result.download.quality,
          title: result.metadata ? result.metadata.title : '',
          duration: result.metadata && result.metadata.duration ? result.metadata.duration.timestamp : '',
          views: result.metadata ? result.metadata.views : '',
          thumbnail: result.metadata ? result.metadata.thumbnail : '',
          author: result.metadata && result.metadata.author ? result.metadata.author.name : ''
        }));
        return;
      } else {
        throw new Error(result && result.message ? result.message : 'Could not resolve stream URL');
      }
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

  // API: Stream proxy for downloading video files directly
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
          // Follow redirect
          client.get(streamRes.headers.location, (redirRes) => {
            const ext = path.extname(filename).toLowerCase();
            const contentType = MIME_TYPES[ext] || 'video/mp4';
            res.writeHead(200, {
              'Content-Type': contentType,
              'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
              'Access-Control-Allow-Origin': '*'
            });
            redirRes.pipe(res);
          }).on('error', () => {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Proxy redirect stream error');
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

  // Check in public/ first, then root directory
  let filePath = path.join(PUBLIC_DIR, reqPath);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(__dirname, reqPath);
  }

  // Prevent directory traversal
  const resolvedPath = path.resolve(filePath);
  if (!resolvedPath.startsWith(__dirname)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  fs.stat(resolvedPath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fallback to index.html for SPA routing
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

    // If download query param is present or it's media/apk, enforce attachment download
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

