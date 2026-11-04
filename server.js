const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { createDecipheriv } = require('crypto');
const { Readable } = require('stream');
const { execFile } = require('child_process');

let vredenScraper = null;
try {
  vredenScraper = require('@vreden/youtube_scraper');
} catch (e) {
  if (e && e.code !== 'MODULE_NOT_FOUND') {
    console.warn('[@vreden/youtube_scraper load warning]:', e.message);
  }
}

const YT_DLP_BIN = fs.existsSync(path.join(__dirname, 'bin', 'yt-dlp'))
  ? path.join(__dirname, 'bin', 'yt-dlp')
  : (fs.existsSync('/usr/local/bin/yt-dlp') ? '/usr/local/bin/yt-dlp' : 'yt-dlp');

try {
  if (fs.existsSync(YT_DLP_BIN)) {
    fs.chmodSync(YT_DLP_BIN, 0o755);
  }
} catch (e) {
  console.warn('[yt-dlp chmod warning]:', e.message);
}

const NODE_BIN = process.execPath || '/usr/local/bin/node';

process.on('uncaughtException', (err) => {
  console.error('[Process Error] Uncaught Exception:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Process Error] Unhandled Rejection:', reason);
});

const PORT = process.env.DEFAULT_APP_PORT || process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
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

// -------------------------------------------------------------
// DEFENSIVE SECURITY ENGINE (RATE LIMITING, SSRF, SANITIZATION)
// -------------------------------------------------------------
const ipRateLimits = new Map();

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || '127.0.0.1';
}

function checkRateLimit(clientIp, maxRequests = 60, windowMs = 60000) {
  const now = Date.now();
  let record = ipRateLimits.get(clientIp);
  if (!record || (now - record.startTime) > windowMs) {
    record = { count: 1, startTime: now };
    ipRateLimits.set(clientIp, record);
    return true;
  }
  record.count++;
  return record.count <= maxRequests;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of ipRateLimits.entries()) {
    if (now - record.startTime > 120000) {
      ipRateLimits.delete(ip);
    }
  }
}, 300000);

function isSafePublicUrl(inputUrl) {
  try {
    const parsed = new URL(inputUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    if (parsed.port && parsed.port !== '80' && parsed.port !== '443') {
      return false;
    }
    const hostname = parsed.hostname.toLowerCase();
    if (!hostname || hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
      return false;
    }
    const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4Match) {
      const a = Number(ipv4Match[1]);
      const b = Number(ipv4Match[2]);
      if (a === 127 || a === 0) return false;
      if (a === 10) return false;
      if (a === 172 && b >= 16 && b <= 31) return false;
      if (a === 192 && b === 168) return false;
      if (a === 169 && b === 254) return false;
      if (a >= 224) return false;
    }
    if (hostname.includes(':') || hostname.startsWith('[') || hostname === '::1') {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// Block removed Instagram & Facebook platforms cleanly
function isUnsupportedPlatformUrl(inputUrl) {
  if (!inputUrl || typeof inputUrl !== 'string') return false;
  try {
    const parsed = new URL(inputUrl);
    const h = parsed.hostname.toLowerCase();
    return (
      h === 'instagram.com' ||
      h.endsWith('.instagram.com') ||
      h === 'instagr.am' ||
      h.endsWith('.cdninstagram.com') ||
      h === 'facebook.com' ||
      h.endsWith('.facebook.com') ||
      h === 'fb.watch' ||
      h === 'fb.gg' ||
      h.endsWith('.fbcdn.net')
    );
  } catch {
    const lower = inputUrl.toLowerCase();
    return (
      lower.includes('instagram.com') ||
      lower.includes('instagr.am') ||
      lower.includes('facebook.com') ||
      lower.includes('fb.watch') ||
      lower.includes('fb.gg')
    );
  }
}

function sanitizeAndValidateUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  let trimmed = rawUrl.trim();
  if (trimmed.length > 2048) return null;
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    if (trimmed.includes('://')) {
      trimmed = 'https://' + trimmed.split('://').slice(1).join('://');
    } else {
      trimmed = 'https://' + trimmed;
    }
  }
  if (!isSafePublicUrl(trimmed)) return null;
  return trimmed;
}

function applyDefensiveSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), payment=()');
  res.removeHeader('X-Powered-By');
  res.removeHeader('Server');
}

async function fetchJson(targetUrl, options = {}) {
  const timeoutMs = options.timeout || 12000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(targetUrl, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    return await res.json();
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

async function postJson(targetUrl, bodyData, options = {}) {
  const timeoutMs = options.timeout || 15000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...(options.headers || {})
      },
      body: JSON.stringify(bodyData),
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    return await res.json();
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// -------------------------------------------------------------
// IN-MEMORY HIGH-SPEED STREAM CACHE
// -------------------------------------------------------------
const STREAM_CACHE = new Map();
const STREAM_CACHE_TTL = 30 * 60 * 1000;

function getCached(key) {
  const entry = STREAM_CACHE.get(key);
  if (!entry) return null;
  if (Date.now() - entry.time > STREAM_CACHE_TTL) {
    STREAM_CACHE.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data) {
  if (STREAM_CACHE.size > 400) {
    const firstKey = STREAM_CACHE.keys().next().value;
    STREAM_CACHE.delete(firstKey);
  }
  STREAM_CACHE.set(key, { time: Date.now(), data });
}

// -------------------------------------------------------------
// VIDEO DOWNLOAD & METADATA HANDLING (YOUTUBE, TIKTOK & WEB)
// -------------------------------------------------------------
function normalizeVideoUrl(inputUrl) {
  if (!inputUrl) return '';
  const trimmed = inputUrl.trim();

  const shortsMatch = trimmed.match(/\/shorts\/([a-zA-Z0-9_-]{11})/i);
  if (shortsMatch && shortsMatch[1]) {
    return `https://www.youtube.com/watch?v=${shortsMatch[1]}`;
  }

  const youtuMatch = trimmed.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/i);
  if (youtuMatch && youtuMatch[1]) {
    return `https://www.youtube.com/watch?v=${youtuMatch[1]}`;
  }

  const watchMatch = trimmed.match(/[?&]v=([a-zA-Z0-9_-]{11})/i);
  if (watchMatch && watchMatch[1]) {
    return `https://www.youtube.com/watch?v=${watchMatch[1]}`;
  }

  return trimmed;
}

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

function extractWithYtDlp(targetUrl, quality = '720', type = 'video') {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(YT_DLP_BIN)) {
      return reject(new Error('yt-dlp binary not available'));
    }
    const qNum = parseInt(quality, 10) || 720;
    const formatArg = type === 'audio'
      ? 'bestaudio[ext=m4a]/bestaudio/best'
      : `best[height<=${qNum}][ext=mp4]/18/b/best[ext=mp4]/best/worst`;

    const jsonArgs = [
      '--js-runtimes', `node:${NODE_BIN}`,
      '--no-playlist',
      '--no-warnings',
      '--dump-single-json',
      targetUrl
    ];

    execFile(YT_DLP_BIN, jsonArgs, { maxBuffer: 15 * 1024 * 1024, timeout: 20000 }, (err, stdout) => {
      if (!err && stdout) {
        try {
          const data = JSON.parse(stdout);
          let chosenUrl = null;
          if (Array.isArray(data.formats) && data.formats.length > 0) {
            if (type === 'audio') {
              const audioOnly = data.formats.filter(f => f.url && (f.acodec !== 'none' || f.vcodec === 'none'));
              const bestAudio = audioOnly.find(f => f.ext === 'm4a' || f.ext === 'mp3') || audioOnly[audioOnly.length - 1];
              if (bestAudio && bestAudio.url) chosenUrl = bestAudio.url;
            } else {
              const progMp4 = data.formats.filter(f => f.url && f.vcodec !== 'none' && f.acodec !== 'none' && f.ext === 'mp4');
              const exactOrLower = progMp4.filter(f => f.height && f.height <= qNum).pop() || progMp4[0];
              if (exactOrLower && exactOrLower.url) {
                chosenUrl = exactOrLower.url;
              } else {
                const anyMp4 = data.formats.filter(f => f.url && f.ext === 'mp4').pop();
                if (anyMp4 && anyMp4.url) chosenUrl = anyMp4.url;
              }
            }
          }
          if (!chosenUrl && data.url) chosenUrl = data.url;

          if (chosenUrl) {
            const dur = data.duration || 60;
            const durLabel = data.duration_string || `${Math.floor(dur / 60)}:${String(dur % 60).padStart(2, '0')}`;
            return resolve({
              downloadUrl: chosenUrl,
              title: data.title || 'Video Media',
              thumbnail: data.thumbnail || '',
              duration: dur,
              durationLabel: durLabel,
              author: data.uploader || data.channel || 'Creator',
              platform: data.extractor_key || data.extractor || 'Web Video'
            });
          }
        } catch (pe) {}
      }

      const gArgs = [
        '--js-runtimes', `node:${NODE_BIN}`,
        '--no-playlist',
        '--no-warnings',
        '-g',
        '-f', formatArg,
        targetUrl
      ];
      execFile(YT_DLP_BIN, gArgs, { timeout: 15000 }, (gErr, gStdout) => {
        if (!gErr && gStdout && gStdout.trim()) {
          const directUrl = gStdout.trim().split('\n')[0];
          if (directUrl && directUrl.startsWith('http')) {
            return resolve({
              downloadUrl: directUrl,
              title: 'Playable Video Stream',
              thumbnail: '',
              duration: 120,
              durationLabel: '02:00',
              author: 'Media Video',
              platform: 'Web Video'
            });
          }
        }
        reject(err || gErr || new Error('yt-dlp could not extract stream for link'));
      });
    });
  });
}

async function extractTikTok(targetUrl) {
  try {
    const tikRes = await fetchJson(`https://www.tikwm.com/api/?url=${encodeURIComponent(targetUrl)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 7000
    });
    if (tikRes && tikRes.code === 0 && tikRes.data) {
      const d = tikRes.data;
      const dur = d.duration || 30;
      return {
        id: d.id || `tiktok_${Date.now()}`,
        title: d.title ? d.title.substring(0, 100).replace(/[\r\n]+/g, ' ') : 'TikTok Video (No Watermark)',
        thumbnail: d.cover || d.origin_cover || '',
        duration: dur,
        durationLabel: `${Math.floor(dur / 60)}:${String(dur % 60).padStart(2, '0')}`,
        directVideo: d.play || d.wmplay,
        directAudio: d.music || d.play,
        author: d.author ? (d.author.nickname || d.author.unique_id) : 'TikTok Creator',
        platform: 'TikTok'
      };
    }
  } catch (e) {
    console.warn('[TikTok TikWM lookup warning]:', e.message);
  }

  try {
    const postBody = new URLSearchParams({ url: targetUrl }).toString();
    const res = await fetch('https://api.tikmate.app/api/lookup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: postBody,
      signal: AbortSignal.timeout(6000)
    });
    if (res.ok) {
      const j = await res.json();
      if (j && j.success && j.id && j.token) {
        return {
          id: j.id,
          title: j.desc || (j.author_name ? `${j.author_name} TikTok Video` : 'TikTok Video (No Watermark)'),
          thumbnail: j.cover || j.dynamic_cover || '',
          duration: 30,
          durationLabel: '0:30',
          directVideo: `https://tikmate.app/download/${j.id}/${j.token}.mp4`,
          directAudio: `https://tikmate.app/download/${j.id}/${j.token}.mp4`,
          author: j.author_name || 'TikTok Creator',
          platform: 'TikTok'
        };
      }
    }
  } catch (e) {
    console.warn('[TikTok TikMate lookup warning]:', e.message);
  }

  try {
    const ytRes = await extractWithYtDlp(targetUrl, '720', 'video');
    if (ytRes && ytRes.downloadUrl) {
      return {
        id: `tiktok_${Date.now()}`,
        title: ytRes.title || 'TikTok Video',
        thumbnail: ytRes.thumbnail || '',
        duration: ytRes.duration || 30,
        durationLabel: ytRes.durationLabel || '0:30',
        directVideo: ytRes.downloadUrl,
        directAudio: ytRes.downloadUrl,
        author: ytRes.author || 'TikTok Creator',
        platform: 'TikTok'
      };
    }
  } catch (e) {}

  return null;
}

async function extractYouTube(targetUrl, quality = '720', type = 'video') {
  const normalizedUrl = normalizeVideoUrl(targetUrl) || targetUrl;
  targetUrl = normalizedUrl;

  if (vredenScraper) {
    try {
      if (type === 'audio' && typeof vredenScraper.ytmp3 === 'function') {
        const mp3Res = await vredenScraper.ytmp3(targetUrl);
        if (mp3Res && mp3Res.download && mp3Res.download.url) {
          return {
            downloadUrl: mp3Res.download.url,
            title: (mp3Res.metadata && mp3Res.metadata.title) || 'YouTube Audio',
            thumbnail: (mp3Res.metadata && (mp3Res.metadata.thumbnail || mp3Res.metadata.image)) || '',
            duration: (mp3Res.metadata && mp3Res.metadata.seconds) || 180,
            durationLabel: (mp3Res.metadata && mp3Res.metadata.timestamp) || '03:00',
            author: (mp3Res.metadata && mp3Res.metadata.author && mp3Res.metadata.author.name) || 'YouTube Artist',
            platform: 'YouTube',
            quality: '320kbps',
            type: 'audio'
          };
        }
      } else if (typeof vredenScraper.ytmp4 === 'function') {
        const mp4Res = await vredenScraper.ytmp4(targetUrl);
        if (mp4Res && mp4Res.download && mp4Res.download.url) {
          return {
            downloadUrl: mp4Res.download.url,
            title: (mp4Res.metadata && mp4Res.metadata.title) || 'YouTube Video',
            thumbnail: (mp4Res.metadata && (mp4Res.metadata.thumbnail || mp4Res.metadata.image)) || '',
            duration: (mp4Res.metadata && mp4Res.metadata.seconds) || 180,
            durationLabel: (mp4Res.metadata && mp4Res.metadata.timestamp) || '03:00',
            author: (mp4Res.metadata && mp4Res.metadata.author && mp4Res.metadata.author.name) || 'YouTube Creator',
            platform: 'YouTube',
            quality: `${quality}p`,
            type: 'video'
          };
        }
      }
    } catch (ve) {
      console.warn('[@vreden/youtube_scraper warning]:', ve.message);
    }
  }

  try {
    const cdnRes = await fetchJson('https://media.savetube.vip/api/random-cdn', { timeout: 5000 });
    const cdn = cdnRes && cdnRes.cdn ? cdnRes.cdn : 'cdn403.savetube.vip';
    const infoRes = await postJson(`https://${cdn}/v2/info`, { url: targetUrl }, {
      headers: { 'Referer': 'https://save-tube.com/', 'User-Agent': 'Mozilla/5.0' },
      timeout: 6000
    });
    if (infoRes && infoRes.data) {
      const info = decodeSavetubeData(infoRes.data);
      if (info && info.key) {
        const qualitiesToTry = [quality.toString()];
        if (type !== 'audio') {
          ['720', '360', '480', '1080'].forEach(q => {
            if (!qualitiesToTry.includes(q)) qualitiesToTry.push(q);
          });
        } else {
          ['128', '320', 'mp3'].forEach(q => {
            if (!qualitiesToTry.includes(q)) qualitiesToTry.push(q);
          });
        }

        for (const q of qualitiesToTry) {
          try {
            const dlRes = await postJson(`https://${cdn}/download`, {
              downloadType: type === 'audio' ? 'audio' : 'video',
              quality: q,
              key: info.key
            }, {
              headers: { 'Referer': 'https://save-tube.com/', 'User-Agent': 'Mozilla/5.0' },
              timeout: 6000
            });
            if (dlRes && dlRes.data && dlRes.data.downloadUrl) {
              return {
                downloadUrl: dlRes.data.downloadUrl,
                title: info.title || 'YouTube Video',
                thumbnail: info.thumbnail || '',
                duration: info.duration || 180,
                durationLabel: info.durationLabel || '03:00',
                author: info.author || 'Creator',
                platform: 'YouTube',
                quality: `${q}p`,
                type: type
              };
            }
          } catch (dlErr) {}
        }
      }
    }
  } catch (se) {
    console.warn('[SaveTube direct warning]:', se.message);
  }

  const ytMatch = targetUrl.match(/[?&]v=([a-zA-Z0-9_-]{11})/) || targetUrl.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/) || targetUrl.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
  const videoId = ytMatch ? ytMatch[1] : null;
  if (videoId) {
    const invidiousHosts = ['inv.nadeko.net', 'yewtu.be', 'vid.puffyan.us'];
    for (const host of invidiousHosts) {
      try {
        const invRes = await fetchJson(`https://${host}/api/v1/videos/${videoId}`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
          timeout: 5000
        });
        if (invRes && Array.isArray(invRes.formatStreams) && invRes.formatStreams.length > 0) {
          const stream = invRes.formatStreams.find(s => s.url) || invRes.formatStreams[0];
          if (stream && stream.url) {
            return {
              downloadUrl: stream.url,
              title: invRes.title || 'YouTube Video',
              thumbnail: (invRes.videoThumbnails && invRes.videoThumbnails[0] && invRes.videoThumbnails[0].url) || '',
              duration: invRes.lengthSeconds || 180,
              durationLabel: `${Math.floor((invRes.lengthSeconds || 180) / 60)}:${String((invRes.lengthSeconds || 180) % 60).padStart(2, '0')}`,
              author: invRes.author || 'Creator',
              platform: 'YouTube',
              quality: `${quality}p`,
              type: type
            };
          }
        }
      } catch (ie) {}
    }
  }

  try {
    const ytdlRes = await extractWithYtDlp(targetUrl, quality, type);
    if (ytdlRes && ytdlRes.downloadUrl) {
      return {
        ...ytdlRes,
        platform: 'YouTube'
      };
    }
  } catch (e) {}

  return null;
}

async function extractUniversalVideo(rawUrl, quality = '720', type = 'video') {
  const cleanUrl = (rawUrl || '').trim();
  if (!cleanUrl) {
    throw new Error('Empty URL provided');
  }
  if (isUnsupportedPlatformUrl(cleanUrl)) {
    throw new Error('Instagram and Facebook video downloading have been removed. Please use YouTube, TikTok, or direct video links.');
  }

  // Tier 1: Direct media stream or file (.mp4, .webm, .mkv, .mov, .mp3, etc.)
  if (/\.(mp4|webm|mkv|mov|avi|flv|m4v|mp3|m4a|wav|aac)(\?.*)?$/i.test(cleanUrl) || cleanUrl.includes('.googlevideo.com/videoplayback')) {
    const filenameSegment = cleanUrl.split('?')[0].split('/').pop() || 'media_video.mp4';
    const isAudio = /\.(mp3|m4a|wav|aac)$/i.test(filenameSegment) || type === 'audio';
    const cleanTitle = filenameSegment.replace(/[^a-zA-Z0-9._-]/g, ' ').replace(/\.[^/.]+$/, '').trim() || 'Media Video';
    return {
      downloadUrl: cleanUrl,
      title: cleanTitle,
      thumbnail: '',
      duration: 120,
      durationLabel: '02:00',
      author: 'Direct Media Source',
      platform: 'Direct Stream',
      quality: isAudio ? '320kbps' : `${quality}p`,
      type: isAudio ? 'audio' : 'video'
    };
  }

  // Tier 2: TikTok videos & audio (watermark-free)
  const isTikTok = cleanUrl.toLowerCase().includes('tiktok.com');
  if (isTikTok) {
    const tt = await extractTikTok(cleanUrl);
    if (tt && (tt.directVideo || tt.directAudio)) {
      return {
        downloadUrl: type === 'audio' && tt.directAudio ? tt.directAudio : tt.directVideo,
        title: tt.title,
        thumbnail: tt.thumbnail || '',
        duration: tt.duration,
        durationLabel: tt.durationLabel,
        author: tt.author,
        platform: 'TikTok',
        quality: type === 'audio' ? 'MP3' : 'HD',
        type: type
      };
    }
  }

  // Tier 3: YouTube Videos, Shorts, Audio
  const isYouTube = cleanUrl.includes('youtube.com') || cleanUrl.includes('youtu.be');
  if (isYouTube) {
    const yt = await extractYouTube(cleanUrl, quality, type);
    if (yt && yt.downloadUrl) {
      return yt;
    }
  }

  // Tier 4: Multi-platform yt-dlp Extractor (X/Twitter, Reddit, Vimeo, Dailymotion, etc.)
  try {
    const ytdlRes = await extractWithYtDlp(cleanUrl, quality, type);
    if (ytdlRes && ytdlRes.downloadUrl) {
      return {
        ...ytdlRes,
        quality: type === 'audio' ? `${quality}kbps` : `${quality}p`,
        type: type
      };
    }
  } catch (ytdlErr) {
    console.warn('[yt-dlp extract warning]:', ytdlErr.message);
  }

  // Tier 5: Universal HTML5 Video Scraper (Public non-blocked video pages)
  try {
    const pageRes = await fetch(cleanUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      signal: AbortSignal.timeout(7000)
    });
    if (pageRes.ok) {
      const html = await pageRes.text();
      const titleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i) ||
                         html.match(/<title>([^<]+)<\/title>/i);
      const pageTitle = titleMatch ? titleMatch[1].trim() : 'Media Video';

      const thumbMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
      const pageThumb = thumbMatch ? thumbMatch[1] : '';

      const ogVidMatch = html.match(/<meta\s+property=["']og:video(?::secure_url|:url)?["']\s+content=["']([^"']+)["']/i) ||
                         html.match(/<meta\s+name=["']twitter:player:stream["']\s+content=["']([^"']+)["']/i) ||
                         html.match(/<video[^>]+src=["']([^"']+)["']/i) ||
                         html.match(/<source[^>]+src=["']([^"']+\.mp4[^"']*)["']/i) ||
                         html.match(/"contentUrl"\s*:\s*"([^"]+)"/i) ||
                         html.match(/(https:\/\/[^"'\s\\]+\.mp4(?:\?[^"'\s\\]*)?)/i);

      if (ogVidMatch && ogVidMatch[1]) {
        let rawStream = ogVidMatch[1];
        if (rawStream.startsWith('//')) rawStream = 'https:' + rawStream;
        else if (rawStream.startsWith('/')) rawStream = new URL(rawStream, cleanUrl).href;

        return {
          downloadUrl: rawStream,
          title: pageTitle,
          thumbnail: pageThumb,
          duration: 60,
          durationLabel: '01:00',
          author: 'Web Media',
          platform: 'Web',
          quality: `${quality}p`,
          type: type
        };
      }
    }
  } catch (he) {
    console.warn('[HTML Scraper warning]:', he.message);
  }

  return null;
}

async function fetchVideoInfo(rawUrl) {
  if (isUnsupportedPlatformUrl(rawUrl)) {
    throw new Error('Instagram and Facebook video downloading have been removed.');
  }

  const cached = getCached(`info_${rawUrl}`);
  if (cached) {
    return cached;
  }

  const isTikTok = rawUrl.toLowerCase().includes('tiktok.com');
  const isYouTube = rawUrl.includes('youtube.com') || rawUrl.includes('youtu.be');

  try {
    const extracted = await extractUniversalVideo(rawUrl, '720', 'video');
    if (extracted) {
      const result = {
        info: {
          id: `media_${Date.now()}`,
          title: extracted.title || 'Video Media',
          thumbnail: extracted.thumbnail || '',
          duration: extracted.duration || 60,
          durationLabel: extracted.durationLabel || '01:00',
          directVideo: extracted.downloadUrl,
          author: extracted.author || 'Creator',
          platform: extracted.platform || (isYouTube ? 'YouTube' : (isTikTok ? 'TikTok' : 'Web Video')),
          key: `key_${Date.now()}`,
          isSocial: !isYouTube,
          originalUrl: rawUrl,
          type: extracted.type || 'video'
        },
        cdn: 'universal',
        normalizedUrl: rawUrl
      };
      setCache(`info_${rawUrl}`, result);
      return result;
    }
  } catch (extractErr) {
    console.warn('[fetchVideoInfo universal extract fallback]:', extractErr.message);
  }

  if (isYouTube) {
    const ytMatch = rawUrl.match(/[?&]v=([a-zA-Z0-9_-]{11})/) || rawUrl.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/) || rawUrl.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
    const ytId = ytMatch ? ytMatch[1] : `yt_${Date.now()}`;
    let ytTitle = 'YouTube Video (High Definition)';
    let ytAuthor = 'YouTube Creator';
    let ytThumb = `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`;

    try {
      const oembedRes = await fetchJson(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${ytId}&format=json`, { timeout: 4000 });
      if (oembedRes && oembedRes.title) {
        ytTitle = oembedRes.title;
        ytAuthor = oembedRes.author_name || ytAuthor;
        ytThumb = oembedRes.thumbnail_url || ytThumb;
      }
    } catch (e) {}

    const result = {
      info: {
        id: ytId,
        title: ytTitle,
        author: ytAuthor,
        thumbnail: ytThumb,
        duration: 180,
        durationLabel: '03:00',
        key: ytId,
        isSocial: false,
        platform: 'YouTube',
        originalUrl: rawUrl,
        type: 'video'
      },
      cdn: 'universal',
      normalizedUrl: rawUrl
    };
    setCache(`info_${rawUrl}`, result);
    return result;
  }

  const fallbackInfo = {
    info: {
      id: `media_${Date.now()}`,
      title: isTikTok ? 'TikTok Video' : 'Online Video Stream',
      thumbnail: '',
      duration: 60,
      durationLabel: '01:00',
      author: 'Creator',
      platform: isTikTok ? 'TikTok' : 'Web Video',
      key: `media_${Date.now()}`,
      isSocial: true,
      originalUrl: rawUrl,
      type: 'video'
    },
    cdn: 'universal',
    normalizedUrl: rawUrl
  };
  setCache(`info_${rawUrl}`, fallbackInfo);
  return fallbackInfo;
}

async function requestDownloadLink(cdn, info, quality, type) {
  const qualityStr = quality.toString();
  const cacheKey = `stream_${info.id || info.key}_${qualityStr}_${type}`;
  const cached = getCached(cacheKey);
  if (cached) {
    return cached;
  }

  const cleanTitle = (info.title || 'video')
    .replace(/[^\w\s.-]/gi, '')
    .trim()
    .replace(/\s+/g, '_')
    .substring(0, 60) || 'media_download';

  if (info.directVideo && type !== 'audio') {
    const res = {
      success: true,
      downloadUrl: info.directVideo,
      filename: `${cleanTitle}_${qualityStr}p.mp4`,
      title: info.title,
      duration: info.durationLabel || 'HD',
      thumbnail: info.thumbnail,
      quality: `${qualityStr}p`,
      type: 'video'
    };
    setCache(cacheKey, res);
    return res;
  }

  const targetUrl = info.originalUrl || info.normalizedUrl || `https://www.youtube.com/watch?v=${info.id || info.key}`;
  const extracted = await extractUniversalVideo(targetUrl, qualityStr, type);

  if (!extracted || !extracted.downloadUrl || extracted.downloadUrl === targetUrl) {
    throw new Error('Unable to extract playable direct stream for this media');
  }

  const ext = type === 'audio' ? 'mp3' : 'mp4';
  const res = {
    success: true,
    downloadUrl: extracted.downloadUrl,
    filename: `${cleanTitle}_${qualityStr}${type === 'audio' ? 'kbps' : 'p'}.${ext}`,
    title: extracted.title || info.title || 'Media Video',
    duration: extracted.durationLabel || info.durationLabel || 'HD',
    thumbnail: extracted.thumbnail || info.thumbnail,
    quality: extracted.quality || `${qualityStr}${type === 'audio' ? 'kbps' : 'p'}`,
    type: type === 'audio' ? 'audio' : 'video'
  };

  setCache(cacheKey, res);
  return res;
}

// -------------------------------------------------------------
// HTTP SERVER
// -------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  applyDefensiveSecurityHeaders(res);

  const clientIp = getClientIp(req);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Range'
    });
    res.end();
    return;
  }

  if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method Not Allowed');
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  let reqPath = parsedUrl.pathname;

  // Fast drop for automated malicious scanners searching for PHP/WordPress/env exploits
  if (reqPath.endsWith('.php') || reqPath.includes('.php/') || reqPath.startsWith('/wp-') || reqPath.includes('phpmyadmin') || reqPath.includes('xmlrpc') || reqPath.startsWith('/.env') || reqPath.startsWith('/.git')) {
    res.writeHead(404, { 'Content-Type': 'text/plain', 'X-Robots-Tag': 'noindex, nofollow' });
    res.end('Not Found');
    return;
  }

  // 301 Redirect /index.html to / and /*.html subpages to clean canonical URLs
  if (reqPath === '/index.html') {
    res.writeHead(301, { 'Location': '/' + (parsedUrl.search || '') });
    res.end();
    return;
  }
  const htmlSubpageMatch = reqPath.match(/^\/(about|dmca|privacy|terms|contact)\.html$/i);
  if (htmlSubpageMatch) {
    res.writeHead(301, { 'Location': `/${htmlSubpageMatch[1].toLowerCase()}` + (parsedUrl.search || '') });
    res.end();
    return;
  }

  // 301 Redirect trailing slash
  if (reqPath.length > 1 && reqPath.endsWith('/')) {
    res.writeHead(301, { 'Location': reqPath.slice(0, -1) + (parsedUrl.search || '') });
    res.end();
    return;
  }

  // Clean 410 Gone for retired /news section so search engines de-index immediately
  if (reqPath === '/news' || reqPath === '/news.html' || reqPath === '/api/news') {
    res.writeHead(410, {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Robots-Tag': 'noindex, nofollow'
    });
    res.end('410 Gone - The news section has been permanently removed.');
    return;
  }

  // Serve crisp vector icon for /favicon.ico requests so Google Favicon & browsers never get 404
  if (reqPath === '/favicon.ico') {
    reqPath = '/favicon.svg';
  }

  const cleanRoutes = {
    '/': '/index.html',
    '/about': '/about.html',
    '/dmca': '/dmca.html',
    '/privacy': '/privacy.html',
    '/terms': '/terms.html',
    '/contact': '/contact.html'
  };

  if (cleanRoutes[reqPath]) {
    reqPath = cleanRoutes[reqPath];
  }

  // Rate Limiting (exempt search engine crawlers & inspection tools on non-API routes)
  const ua = String(req.headers['user-agent'] || '');
  const isSearchCrawler = /Googlebot|Google-InspectionTool|InspectionTool|AdsBot-Google|Mediapartners-Google|bingbot|Applebot/i.test(ua);
  const isApiReq = reqPath.startsWith('/api/');
  if (isApiReq || !isSearchCrawler) {
    const maxReqs = isApiReq ? 40 : 180;
    if (!checkRateLimit(clientIp, maxReqs, 60000)) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' });
      res.end(JSON.stringify({ success: false, error: 'Rate limit exceeded. Please wait a moment.' }));
      return;
    }
  }

  // Health check endpoint
  if (reqPath === '/healthz' || reqPath === '/health' || reqPath === '/api/health' || reqPath === '/ping') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
      'X-Robots-Tag': 'noindex, nofollow'
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    res.end(JSON.stringify({
      status: 'ok',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString()
    }));
    return;
  }

  // Direct APK Download Route
  if (reqPath === '/download-apk' || reqPath === '/api/download-apk' || reqPath === '/YT_Download.apk' || reqPath === '/app-debug.apk') {
    const candidatePaths = [
      path.join(__dirname, '.build-outputs', 'app-debug.apk'),
      path.join(__dirname, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'),
      path.join(PUBLIC_DIR, 'YT_Download.apk')
    ];

    const apkPath = candidatePaths.find(p => fs.existsSync(p));
    if (!apkPath) {
      res.writeHead(404, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'X-Robots-Tag': 'noindex, nofollow'
      });
      res.end('APK file is currently being built or was not found. Please try again in a moment.');
      return;
    }

    const stat = fs.statSync(apkPath);
    const headers = {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Length': stat.size,
      'Content-Disposition': 'attachment; filename="YT_Download.apk"',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Access-Control-Allow-Origin': '*'
    };

    if (req.method === 'HEAD') {
      res.writeHead(200, headers);
      res.end();
      return;
    }

    res.writeHead(200, headers);
    const stream = fs.createReadStream(apkPath);
    stream.on('error', (streamErr) => {
      console.error('[APK Download Error]', streamErr.message);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Server error streaming APK file');
      }
    });
    stream.pipe(res);
    return;
  }

  // API: Analyze Video
  if (reqPath === '/api/analyze') {
    const rawVideoUrl = parsedUrl.query.url;
    const videoUrl = sanitizeAndValidateUrl(rawVideoUrl);
    if (!videoUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: false, error: 'Invalid or unsupported URL parameter' }));
      return;
    }
    if (isUnsupportedPlatformUrl(videoUrl)) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({
        success: false,
        error: 'Instagram and Facebook video downloading are not supported. Please paste a YouTube, Shorts, TikTok, or direct video link.'
      }));
      return;
    }

    const availableQualities = [
      { quality: '1080', label: '1080p (Full HD)', type: 'video', ext: 'mp4', badge: '1080p Full HD' },
      { quality: '720', label: '720p (HD Standard)', type: 'video', ext: 'mp4', badge: '720p HD' },
      { quality: '480', label: '480p (Standard)', type: 'video', ext: 'mp4', badge: '480p SD' },
      { quality: '360', label: '360p (Fast / Data Saver)', type: 'video', ext: 'mp4', badge: '360p Fast' },
      { quality: '320', label: 'MP3 Audio (320 kbps Studio)', type: 'audio', ext: 'mp3', badge: '320kbps MP3' },
      { quality: '128', label: 'MP3 Audio (128 kbps Standard)', type: 'audio', ext: 'mp3', badge: '128kbps MP3' }
    ];

    try {
      const { info, normalizedUrl } = await fetchVideoInfo(videoUrl);

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300'
      });
      res.end(JSON.stringify({
        success: true,
        video: {
          id: info.id,
          title: info.title,
          thumbnail: info.thumbnail,
          duration: info.duration,
          durationLabel: info.durationLabel,
          channel: info.author || info.uploader || (info.isSocial ? info.platform : 'YouTube Creator'),
          formats: availableQualities,
          platform: info.platform || 'YouTube',
          type: 'video',
          normalizedUrl
        }
      }));
    } catch (err) {
      let hostname = 'Web';
      let cleanTitle = 'Media Video';
      try {
        const u = new URL(videoUrl);
        hostname = u.hostname.replace('www.', '');
        const lastPart = u.pathname.split('/').filter(Boolean).pop() || '';
        if (lastPart) cleanTitle = decodeURIComponent(lastPart).replace(/[^a-zA-Z0-9._-]/g, ' ').trim();
      } catch (e) {}

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300'
      });
      res.end(JSON.stringify({
        success: true,
        video: {
          id: `media_${Date.now()}`,
          title: cleanTitle || 'Online Video',
          thumbnail: '',
          duration: 60,
          durationLabel: '01:00',
          channel: hostname,
          formats: availableQualities,
          platform: hostname.includes('youtube') ? 'YouTube' : (hostname.includes('tiktok') ? 'TikTok' : hostname),
          type: 'video',
          normalizedUrl: videoUrl
        }
      }));
    }
    return;
  }

  // API: Generate Download Link / Resolve Stream
  if (reqPath === '/api/download' || reqPath === '/api/resolve') {
    const rawVideoUrl = parsedUrl.query.url;
    const videoUrl = sanitizeAndValidateUrl(rawVideoUrl);
    const quality = parsedUrl.query.quality || '720';
    const type = parsedUrl.query.type || 'video';

    if (!videoUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: false, error: 'Invalid or unsupported URL parameter' }));
      return;
    }
    if (isUnsupportedPlatformUrl(videoUrl)) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({
        success: false,
        error: 'Instagram and Facebook video downloading are not supported. Please paste a YouTube, Shorts, TikTok, or direct video link.'
      }));
      return;
    }

    try {
      const { info, cdn } = await fetchVideoInfo(videoUrl);
      const downloadData = await requestDownloadLink(cdn, info, quality, type);
      const streamProxyUrl = `/api/proxy?url=${encodeURIComponent(downloadData.downloadUrl)}&filename=${encodeURIComponent(downloadData.filename)}&type=${type}`;

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=600'
      });
      res.end(JSON.stringify({
        ...downloadData,
        streamProxyUrl,
        fastCached: true
      }));
    } catch (err) {
      console.warn('Download link resolution error:', err.message);
      res.writeHead(422, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({
        success: false,
        error: 'Unable to extract a downloadable video stream for this link. Please ensure the link is public or try another quality.'
      }));
    }
    return;
  }

  // API: 1-Click Instant Fast Download
  if (reqPath === '/api/fast-download') {
    const rawVideoUrl = parsedUrl.query.url;
    const videoUrl = sanitizeAndValidateUrl(rawVideoUrl);
    const quality = parsedUrl.query.quality || '720';
    const type = parsedUrl.query.type || 'video';

    if (!videoUrl || isUnsupportedPlatformUrl(videoUrl)) {
      res.writeHead(400, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
      res.end('Unsupported or invalid video URL');
      return;
    }

    try {
      const { info, cdn } = await fetchVideoInfo(videoUrl);
      const downloadData = await requestDownloadLink(cdn, info, quality, type);

      if (downloadData && downloadData.downloadUrl) {
        const proxyRedirect = `/api/proxy?url=${encodeURIComponent(downloadData.downloadUrl)}&filename=${encodeURIComponent(downloadData.filename)}&type=${type}`;
        res.writeHead(302, { 'Location': proxyRedirect });
        res.end();
        return;
      }
    } catch (e) {
      console.warn('Fast download error:', e.message);
    }

    res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ success: false, error: 'Direct download unavailable for this media.' }));
    return;
  }

  // API: Stream Proxy with Attachment Disposition
  if (reqPath === '/api/proxy' || reqPath === '/api/stream') {
    const rawTargetUrl = parsedUrl.query.url;
    const targetUrl = sanitizeAndValidateUrl(rawTargetUrl);
    const rawFilename = parsedUrl.query.filename || 'download.mp4';
    const safeFilename = String(rawFilename).replace(/[\r\n"\\/]/g, '').trim().slice(0, 200) || 'download.mp4';
    const type = parsedUrl.query.type || 'video';
    const contentType = type === 'audio' ? 'audio/mpeg' : 'video/mp4';

    if (!targetUrl || isUnsupportedPlatformUrl(targetUrl) || targetUrl.includes('youtube.com/watch') || targetUrl.includes('youtube.com/shorts') || targetUrl.includes('youtu.be/')) {
      res.writeHead(400, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
      res.end('Invalid or prohibited target media URL');
      return;
    }

    try {
      const isTiktok = targetUrl.includes('tiktok') || targetUrl.includes('tikwm') || targetUrl.includes('nowmvideo') || targetUrl.includes('tikmate');
      const reqHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        'Accept': '*/*'
      };
      if (req.headers.range) {
        reqHeaders['Range'] = req.headers.range;
      }
      if (isTiktok) {
        reqHeaders['Referer'] = 'https://www.tiktok.com/';
      } else if (targetUrl.includes('savetube')) {
        reqHeaders['Referer'] = 'https://save-tube.com/';
      }

      const proxyRes = await fetch(targetUrl, {
        headers: reqHeaders,
        redirect: 'follow'
      });

      if (!proxyRes.ok || !proxyRes.body) {
        throw new Error(`Proxy target error: HTTP ${proxyRes.status}`);
      }

      const upstreamContentType = proxyRes.headers.get('content-type') || '';
      let finalContentType = contentType;
      let finalFilename = safeFilename;

      if (type === 'video') {
        finalContentType = upstreamContentType.includes('video/') ? upstreamContentType : 'video/mp4';
        if (!/\.(mp4|m4v|mov|webm)$/i.test(finalFilename)) {
          finalFilename = finalFilename.replace(/\.[^/.]+$/, '') + '.mp4';
        }
      } else if (type === 'audio') {
        finalContentType = upstreamContentType.includes('audio/') ? upstreamContentType : 'audio/mpeg';
        if (!/\.(mp3|m4a|aac|wav)$/i.test(finalFilename)) {
          finalFilename = finalFilename.replace(/\.[^/.]+$/, '') + '.mp3';
        }
      }

      const cleanAscii = finalFilename.replace(/[^a-zA-Z0-9._-]/g, '_');
      const responseHeaders = {
        'Content-Type': finalContentType,
        'Content-Disposition': `attachment; filename="${cleanAscii}"; filename*=UTF-8''${encodeURIComponent(finalFilename)}`,
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache'
      };

      const contentLength = proxyRes.headers.get('content-length');
      if (contentLength) {
        responseHeaders['Content-Length'] = contentLength;
      }
      if (proxyRes.headers.get('content-range')) {
        responseHeaders['Content-Range'] = proxyRes.headers.get('content-range');
      }

      res.writeHead(proxyRes.status || 200, responseHeaders);

      const nodeStream = Readable.fromWeb(proxyRes.body);
      nodeStream.on('error', (e) => console.error('[Proxy Stream Error]', e.message));
      nodeStream.pipe(res);
      return;
    } catch (err) {
      console.error('Proxy stream error:', err.message);
      if (!res.headersSent) {
        if (targetUrl && (targetUrl.includes('googlevideo.com') || targetUrl.includes('savetube') || targetUrl.includes('tiktokcdn'))) {
          res.writeHead(302, { 'Location': targetUrl });
          res.end();
        } else {
          res.writeHead(502, { 'Content-Type': 'text/plain' });
          res.end('Upstream media stream temporarily unavailable. Please try again.');
        }
      }
      return;
    }
  }

  // Static Files Handling & Strict 404
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
      res.writeHead(404, {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Robots-Tag': 'noindex, nofollow'
      });
      res.end(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>404 Not Found - YT Download</title><meta name="robots" content="noindex, nofollow"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>body{font-family:system-ui,-apple-system,sans-serif;text-align:center;padding:80px 20px;color:#1e293b;background:#f8fafc;}h1{font-size:2rem;color:#e50914;}p{color:#64748b;font-size:1.1rem;}a{display:inline-block;margin-top:20px;padding:12px 24px;background:#e50914;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;}</style></head><body><h1>404 - Page Not Found</h1><p>The requested page or media was not found on this server.</p><a href="/">&larr; Return to YT Download</a></body></html>`);
      return;
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const isHtml = ext === '.html';
    const isXml = ext === '.xml';
    const isTxt = ext === '.txt';
    const etag = `W/"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`;

    const headers = {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Last-Modified': stats.mtime.toUTCString(),
      'ETag': etag,
      'X-Content-Type-Options': 'nosniff'
    };

    if (isHtml) {
      headers['Content-Language'] = 'en';
      headers['X-Robots-Tag'] = 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';
      headers['Cache-Control'] = 'public, max-age=600, s-maxage=3600, stale-while-revalidate=86400';
      headers['X-Frame-Options'] = 'SAMEORIGIN';
      headers['Referrer-Policy'] = 'strict-origin-when-cross-origin';
    } else if (isXml || isTxt) {
      headers['Cache-Control'] = 'public, max-age=1800';
    } else if (ext === '.css' || ext === '.js') {
      headers['Cache-Control'] = 'public, max-age=300, must-revalidate';
    } else if (ext === '.apk') {
      headers['X-Robots-Tag'] = 'noindex, nofollow';
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
    } else {
      headers['Cache-Control'] = 'public, max-age=86400';
    }

    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      res.end();
      return;
    }

    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (urlObj.searchParams.get('download') === '1' || ext === '.apk') {
      const downloadFilename = urlObj.searchParams.get('filename') || path.basename(resolvedPath);
      headers['Content-Disposition'] = `attachment; filename="${downloadFilename}"`;
    }

    if (req.method === 'HEAD') {
      res.writeHead(200, headers);
      res.end();
      return;
    }

    res.writeHead(200, headers);
    const stream = fs.createReadStream(resolvedPath);
    stream.on('error', (e) => {
      console.error('[Static Stream Error]', e.message);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('500 Internal Server Error');
      }
    });
    stream.pipe(res);
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.warn(`[Server Warning] Port ${PORT} already in use. Retrying in 1.5s...`);
    setTimeout(() => {
      try {
        server.close();
      } catch (e) {}
      server.listen(PORT, '0.0.0.0', () => {
        console.log(`YT Download server running live on port ${PORT}`);
      });
    }, 1500);
  } else {
    console.error('[Server Error]:', err.message);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`YT Download server running live on port ${PORT}`);
});

function startRenderKeepAlive() {
  const RENDER_DOMAIN = process.env.RENDER_EXTERNAL_URL || 'https://ytdownload-ti50.onrender.com';
  const KEEP_ALIVE_INTERVAL = 10 * 60 * 1000;
  setInterval(() => {
    try {
      const pingUrl = `${RENDER_DOMAIN}/api/health`;
      const client = pingUrl.startsWith('https') ? https : http;
      client.get(pingUrl, { timeout: 10000 }, () => {}).on('error', () => {});
    } catch (e) {}
  }, KEEP_ALIVE_INTERVAL);
}

startRenderKeepAlive();
