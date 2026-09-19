const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { createDecipheriv } = require('crypto');
const { Readable } = require('stream');

// Graceful error handling so server never crashes unexpectedly
process.on('uncaughtException', (err) => {
  console.error('[Process Error] Uncaught Exception:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Process Error] Unhandled Rejection:', reason);
});

const PORT = process.env.DEFAULT_APP_PORT || process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const NEWS_CACHE_FILE = path.join(__dirname, 'news-cache.json');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
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

// Built-in HTTP fetch helper with timeout (replaces external axios)
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
// GOOGLE NEWS SERVICE - DAILY AUTO-UPDATE
// -------------------------------------------------------------
const GOOGLE_NEWS_CATEGORIES = [
  { id: 'all', name: 'Top Headlines', url: 'https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en' },
  { id: 'technology', name: 'Technology & AI', url: 'https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=en-US&gl=US&ceid=US:en' },
  { id: 'entertainment', name: 'Entertainment', url: 'https://news.google.com/rss/headlines/section/topic/ENTERTAINMENT?hl=en-US&gl=US&ceid=US:en' },
  { id: 'world', name: 'World News', url: 'https://news.google.com/rss/headlines/section/topic/WORLD?hl=en-US&gl=US&ceid=US:en' },
  { id: 'business', name: 'Business', url: 'https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=en-US&gl=US&ceid=US:en' }
];

let newsState = {
  lastUpdated: null,
  isUpdating: false,
  articles: [],
  categories: GOOGLE_NEWS_CATEGORIES.map(c => ({ id: c.id, name: c.name }))
};

// Helper: Clean HTML entities
function cleanHtml(text) {
  if (!text) return '';
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Helper: Calculate relative time
function formatRelativeTime(date) {
  const diffMs = Math.max(0, Date.now() - date.getTime());
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// Curated high-resolution related news images by category & topic
const NEWS_IMAGE_POOLS = {
  technology: [
    'https://images.unsplash.com/photo-1518770660439-4636190af475?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1677442136019-21780ecad995?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1592750475338-74b7b21085ab?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1610945265064-0e34e5519bbf?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1612287233261-26c99c855a73?w=600&auto=format&fit=crop&q=80'
  ],
  business: [
    'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1590283603385-17ffb3a7f29f?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1559526324-4b87b5e36e44?w=600&auto=format&fit=crop&q=80'
  ],
  entertainment: [
    'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1522869635100-9f4c5e86aa37?w=600&auto=format&fit=crop&q=80'
  ],
  world: [
    'https://images.unsplash.com/photo-1526778548025-fa2f459cd5c1?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1541872703-74c5e44368f9?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1585829365295-ab7cd400c167?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1509099836639-18ba1795216d?w=600&auto=format&fit=crop&q=80'
  ],
  general: [
    'https://images.unsplash.com/photo-1585829365295-ab7cd400c167?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1495020689067-958852a7765e?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1588681664899-f142ff2dc9b1?w=600&auto=format&fit=crop&q=80'
  ]
};

// Keyword-based and deterministic related image matcher
function getRelatedNewsImage(title, categoryId) {
  const t = (title || '').toLowerCase();

  if (/\b(iphone|apple|ios|macbook|ipad)\b/i.test(t)) {
    return 'https://images.unsplash.com/photo-1592750475338-74b7b21085ab?w=600&auto=format&fit=crop&q=80';
  }
  if (/\b(galaxy|samsung|pixel|android)\b/i.test(t)) {
    return 'https://images.unsplash.com/photo-1610945265064-0e34e5519bbf?w=600&auto=format&fit=crop&q=80';
  }
  if (/\b(nintendo|switch|playstation|ps5|xbox|gaming|gamer|games?)\b/i.test(t)) {
    return 'https://images.unsplash.com/photo-1612287233261-26c99c855a73?w=600&auto=format&fit=crop&q=80';
  }
  if (/\b(ai|artificial intelligence|chatgpt|openai|gemini|robot|deep learning|machine learning)\b/i.test(t)) {
    return 'https://images.unsplash.com/photo-1677442136019-21780ecad995?w=600&auto=format&fit=crop&q=80';
  }
  if (/\b(nvidia|chip|chips|processor|intel|amd|laptop|pc|gpu)\b/i.test(t)) {
    return 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=600&auto=format&fit=crop&q=80';
  }
  if (/\b(war|attack|military|conflict|army|navy|missile|tank|troops|ceasefire|ships?|strait|bomb|drone)\b/i.test(t)) {
    return 'https://images.unsplash.com/photo-1541872703-74c5e44368f9?w=600&auto=format&fit=crop&q=80';
  }
  if (/\b(queen|king|royal|prince|princess|monarchy|diana|monarch)\b/i.test(t)) {
    return 'https://images.unsplash.com/photo-1585829365295-ab7cd400c167?w=600&auto=format&fit=crop&q=80';
  }
  if (/\b(trump|biden|election|senate|congress|republican|democrat|gop|president|law|court|judge|vote)\b/i.test(t)) {
    return 'https://images.unsplash.com/photo-1541872703-74c5e44368f9?w=600&auto=format&fit=crop&q=80';
  }
  if (/\b(dengue|measles|virus|hospital|health|doctor|vaccine|disease|medical|nicu|cdc|fda)\b/i.test(t)) {
    return 'https://images.unsplash.com/photo-1584515979956-d9f6e5d09982?w=600&auto=format&fit=crop&q=80';
  }
  if (/\b(stock|stocks|market|markets|wall street|fed|inflation|crypto|bitcoin|economy|banking|finance)\b/i.test(t)) {
    return 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=600&auto=format&fit=crop&q=80';
  }
  if (/\b(movie|movies|film|films|hollywood|cinema|oscar|trailer|actor|actress|netflix|series|hbo)\b/i.test(t)) {
    return 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=600&auto=format&fit=crop&q=80';
  }
  if (/\b(music|song|songs|album|concert|band|singer|grammy|billboard|pop|rock|rap)\b/i.test(t)) {
    return 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80';
  }
  if (/\b(football|soccer|nfl|nba|olympic|olympics|cricket|tennis|sport|sports|fifa|uefa)\b/i.test(t)) {
    return 'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?w=600&auto=format&fit=crop&q=80';
  }
  if (/\b(space|nasa|moon|mars|telescope|planet|spacex|astronaut|rocket)\b/i.test(t)) {
    return 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=600&auto=format&fit=crop&q=80';
  }

  // Consistent hash-based pool selection
  const pool = NEWS_IMAGE_POOLS[categoryId] || NEWS_IMAGE_POOLS.general;
  let hash = 0;
  for (let i = 0; i < (title || '').length; i++) {
    hash = ((hash << 5) - hash) + title.charCodeAt(i);
    hash |= 0;
  }
  const idx = Math.abs(hash) % pool.length;
  return pool[idx];
}

// Clean HTML snippet from Google News RSS description
function cleanGoogleNewsSnippet(rawDesc, fallbackTitle) {
  if (!rawDesc) return fallbackTitle || '';
  
  // Unescape HTML entities first so <ol> and <li> become actual tags to strip
  let decoded = rawDesc
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ');

  // Strip all HTML markup
  let cleanText = decoded.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  // If the clean text is too short or is only a URL, use fallback title
  if (!cleanText || cleanText.length < 15 || cleanText.startsWith('http')) {
    return fallbackTitle || 'Read the full verified story and coverage on Google News.';
  }

  return cleanText;
}

// Helper: Parse Google News RSS Feed
function parseGoogleNewsRss(xmlText, categoryId, categoryName) {
  const items = [];
  const itemMatches = xmlText.matchAll(/<item>([\s\S]*?)<\/item>/gi);
  for (const match of itemMatches) {
    const itemXml = match[1];
    let title = (itemXml.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '';
    let link = (itemXml.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '';
    const pubDateStr = (itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || '';
    const desc = (itemXml.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || '';
    const sourceMatch = itemXml.match(/<source[^>]*url="([^"]*)"[^>]*>([\s\S]*?)<\/source>/i);
    const source = sourceMatch ? cleanHtml(sourceMatch[2]) : 'Google News';
    const sourceUrl = sourceMatch ? sourceMatch[1] : '';

    title = cleanHtml(title);
    if (source && title.endsWith(` - ${source}`)) {
      title = title.substring(0, title.length - (source.length + 3)).trim();
    }

    const snippet = cleanGoogleNewsSnippet(desc, title);
    const pubDate = pubDateStr ? new Date(pubDateStr) : new Date();

    // Determine domain for publisher favicon
    let domain = '';
    try {
      if (sourceUrl) {
        domain = new URL(sourceUrl).hostname.replace(/^www\./, '');
      } else if (link) {
        domain = 'news.google.com';
      }
    } catch (e) {
      domain = 'news.google.com';
    }

    const sourceFavicon = domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64` : '';
    const imageUrl = getRelatedNewsImage(title, categoryId);

    if (title && link) {
      items.push({
        id: Buffer.from(link).toString('base64').substring(0, 24),
        title,
        link: link.trim(),
        source,
        sourceUrl,
        sourceFavicon,
        imageUrl,
        category: categoryId,
        categoryName,
        pubDate: pubDate.toISOString(),
        timeAgo: formatRelativeTime(pubDate),
        snippet: snippet.substring(0, 240)
      });
    }
  }
  return items;
}

// Update News from Google News
async function refreshGoogleNews(force = false) {
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
  if (!force && newsState.lastUpdated) {
    const elapsed = Date.now() - new Date(newsState.lastUpdated).getTime();
    if (elapsed < TWENTY_FOUR_HOURS && newsState.articles.length > 0) {
      return newsState;
    }
  }

  if (newsState.isUpdating) {
    return newsState;
  }

  newsState.isUpdating = true;
  console.log('[Google News] Fetching daily news update from Google...');

  try {
    const allArticles = [];
    const seenTitles = new Set();

    for (const cat of GOOGLE_NEWS_CATEGORIES) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(cat.url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          },
          signal: controller.signal
        });
        clearTimeout(timer);

        if (res.ok) {
          const xml = await res.text();
          const items = parseGoogleNewsRss(xml, cat.id, cat.name);
          for (const item of items) {
            const key = item.title.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (!seenTitles.has(key)) {
              seenTitles.add(key);
              allArticles.push(item);
            }
          }
        }
      } catch (err) {
        console.warn(`[Google News] Failed fetching category ${cat.name}:`, err.message);
      }
    }

    if (allArticles.length > 0) {
      // Sort newest first
      allArticles.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());

      newsState.articles = allArticles;
      newsState.lastUpdated = new Date().toISOString();

      // Persist to cache file
      try {
        fs.writeFileSync(NEWS_CACHE_FILE, JSON.stringify({
          lastUpdated: newsState.lastUpdated,
          articles: newsState.articles
        }, null, 2));
      } catch (e) {
        console.warn('[Google News] Could not write cache file:', e.message);
      }

      console.log(`[Google News] Successfully updated ${allArticles.length} recent articles. Next update in 24 hours.`);
    }
  } catch (err) {
    console.error('[Google News] Error updating news:', err.message);
  } finally {
    newsState.isUpdating = false;
  }

  return newsState;
}

// Load cached news on startup
function initNewsCache() {
  try {
    if (fs.existsSync(NEWS_CACHE_FILE)) {
      const saved = JSON.parse(fs.readFileSync(NEWS_CACHE_FILE, 'utf8'));
      if (saved && Array.isArray(saved.articles) && saved.articles.length > 0) {
        newsState.articles = saved.articles.map(article => {
          if (!article.imageUrl) {
            article.imageUrl = getRelatedNewsImage(article.title, article.category);
          }
          if (!article.sourceFavicon && article.sourceUrl) {
            try {
              const dom = new URL(article.sourceUrl).hostname.replace(/^www\./, '');
              article.sourceFavicon = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(dom)}&sz=64`;
            } catch (e) {}
          }
          article.snippet = cleanGoogleNewsSnippet(article.snippet, article.title);
          return article;
        });
        newsState.lastUpdated = saved.lastUpdated;
        console.log(`[Google News] Loaded and enriched ${saved.articles.length} cached articles with related images (Updated: ${saved.lastUpdated})`);
      }
    }
  } catch (e) {
    console.warn('[Google News] Failed to load cache file:', e.message);
  }

  // Initial fetch or refresh
  refreshGoogleNews().catch(err => console.error('[Google News] Startup fetch error:', err.message));

  // Schedule daily automatic update check every 30 minutes
  setInterval(() => {
    refreshGoogleNews(false).catch(err => console.error('[Google News] Periodic check error:', err.message));
  }, 30 * 60 * 1000);
}
initNewsCache();

// -------------------------------------------------------------
// IN-MEMORY HIGH-SPEED STREAM CACHE (ULTRA-FAST DOWNLOADS)
// -------------------------------------------------------------
const STREAM_CACHE = new Map();
const STREAM_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

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
  if (STREAM_CACHE.size > 500) {
    const firstKey = STREAM_CACHE.keys().next().value;
    STREAM_CACHE.delete(firstKey);
  }
  STREAM_CACHE.set(key, { time: Date.now(), data });
}

// -------------------------------------------------------------
// VIDEO DOWNLOAD & METADATA HANDLING
// -------------------------------------------------------------
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

async function fetchVideoInfo(rawUrl) {
  const cached = getCached(`info_${rawUrl}`);
  if (cached) {
    return cached;
  }

  const isTikTok = rawUrl.toLowerCase().includes('tiktok.com');
  const isInstagram = rawUrl.toLowerCase().includes('instagram.com');

  if (isTikTok) {
    try {
      const tikRes = await fetchJson(`https://www.tikwm.com/api/?url=${encodeURIComponent(rawUrl)}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 7000
      });
      if (tikRes && tikRes.code === 0 && tikRes.data) {
        const d = tikRes.data;
        const dur = d.duration || 30;
        const durLabel = `${Math.floor(dur / 60)}:${String(dur % 60).padStart(2, '0')}`;
        const result = {
          info: {
            id: d.id || `tiktok_${Date.now()}`,
            title: d.title ? d.title.substring(0, 100).replace(/[\r\n]+/g, ' ') : 'TikTok Video (No Watermark)',
            thumbnail: d.cover || d.origin_cover || 'https://images.unsplash.com/photo-1611162617474-5b21e879e113?w=600&auto=format&fit=crop&q=80',
            duration: dur,
            durationLabel: durLabel,
            directVideo: d.play || d.wmplay,
            directAudio: d.music || d.play,
            key: 'tiktok',
            isTikTok: true,
            isSocial: true,
            platform: 'TikTok',
            originalUrl: rawUrl
          },
          cdn: 'tiktok',
          normalizedUrl: rawUrl
        };
        setCache(`info_${rawUrl}`, result);
        return result;
      }
    } catch (tikErr) {
      console.warn('TikWM fetch failed, falling back:', tikErr.message);
    }

    const fallbackTikTok = {
      info: {
        id: `tiktok_${Date.now()}`,
        title: 'TikTok Video (No Watermark)',
        thumbnail: 'https://images.unsplash.com/photo-1611162617474-5b21e879e113?w=600&auto=format&fit=crop&q=80',
        duration: 30,
        durationLabel: '0:30',
        key: 'social_key',
        isSocial: true,
        platform: 'TikTok',
        originalUrl: rawUrl
      },
      cdn: 'social',
      normalizedUrl: rawUrl
    };
    setCache(`info_${rawUrl}`, fallbackTikTok);
    return fallbackTikTok;
  }

  if (isInstagram) {
    const fallbackIg = {
      info: {
        id: `insta_${Date.now()}`,
        title: 'Instagram Reel (Full HD)',
        thumbnail: 'https://images.unsplash.com/photo-1611262588024-d12430b98920?w=600&auto=format&fit=crop&q=80',
        duration: 30,
        durationLabel: '0:30',
        key: 'social_key',
        isSocial: true,
        platform: 'Instagram',
        originalUrl: rawUrl
      },
      cdn: 'social',
      normalizedUrl: rawUrl
    };
    setCache(`info_${rawUrl}`, fallbackIg);
    return fallbackIg;
  }

  const normalizedUrl = normalizeVideoUrl(rawUrl);

  try {
    const cdnRes = await fetchJson('https://media.savetube.vip/api/random-cdn', {
      timeout: 6000
    });
    const cdn = cdnRes && cdnRes.cdn ? cdnRes.cdn : 'cdn403.savetube.vip';

    const infoRes = await postJson(`https://${cdn}/v2/info`, {
      url: normalizedUrl
    }, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36',
        'Referer': 'https://save-tube.com/'
      },
      timeout: 8000
    });

    if (infoRes && infoRes.data) {
      const info = decodeSavetubeData(infoRes.data);
      const result = { info, cdn, normalizedUrl };
      setCache(`info_${rawUrl}`, result);
      return result;
    }
  } catch (savetubeErr) {
    console.warn('Savetube metadata fetch failed, trying fast oEmbed fallback:', savetubeErr.message);
  }

  // Fallback YouTube metadata resolution via oEmbed
  const ytMatch = normalizedUrl.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  const ytId = ytMatch ? ytMatch[1] : 'video_fallback';
  let ytTitle = 'YouTube Video (High Definition)';
  let ytAuthor = 'Creator';
  let ytThumb = `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`;

  try {
    const oembedRes = await fetchJson(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${ytId}&format=json`, {
      timeout: 4000
    });
    if (oembedRes && oembedRes.title) {
      ytTitle = oembedRes.title;
      ytAuthor = oembedRes.author_name || ytAuthor;
      ytThumb = oembedRes.thumbnail_url || ytThumb;
    }
  } catch (e) {}

  const fallbackResult = {
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
      originalUrl: rawUrl
    },
    cdn: 'cdn403.savetube.vip',
    normalizedUrl
  };
  setCache(`info_${rawUrl}`, fallbackResult);
  return fallbackResult;
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
    .substring(0, 60);
  const ext = type === 'audio' ? 'mp3' : 'mp4';

  if (info.isSocial) {
    if (info.directVideo && type !== 'audio') {
      const res = {
        success: true,
        downloadUrl: info.directVideo,
        filename: `${cleanTitle}_HD.${ext}`,
        title: info.title,
        duration: info.durationLabel,
        thumbnail: info.thumbnail,
        quality: 'HD',
        type: 'video'
      };
      setCache(cacheKey, res);
      return res;
    }
  }

  try {
    const dlRes = await postJson(`https://${cdn}/download`, {
      downloadType: type === 'audio' ? 'audio' : 'video',
      quality: qualityStr,
      key: info.key
    }, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36',
        'Referer': 'https://save-tube.com/'
      },
      timeout: 12000
    });

    if (dlRes && dlRes.data && dlRes.data.downloadUrl) {
      const res = {
        success: true,
        downloadUrl: dlRes.data.downloadUrl,
        filename: `${cleanTitle}_${qualityStr}${type === 'audio' ? 'kbps' : 'p'}.${ext}`,
        title: info.title,
        duration: info.durationLabel || `${Math.floor(info.duration / 60)}:${(info.duration % 60).toString().padStart(2, '0')}`,
        thumbnail: info.thumbnail,
        quality: `${qualityStr}${type === 'audio' ? 'kbps' : 'p'}`,
        type: type
      };
      setCache(cacheKey, res);
      return res;
    }
  } catch (savetubeErr) {
    console.warn('Savetube download call error:', savetubeErr.message);
  }

  if (Array.isArray(info.video_formats)) {
    const anyDirect = info.video_formats.find(f => f.url && f.url.startsWith('http'));
    if (anyDirect) {
      const res = {
        success: true,
        downloadUrl: anyDirect.url,
        filename: `${cleanTitle}_${qualityStr}p.mp4`,
        title: info.title,
        duration: info.durationLabel || 'Full',
        thumbnail: info.thumbnail,
        quality: `${qualityStr}p`,
        type: type
      };
      setCache(cacheKey, res);
      return res;
    }
  }

  // Direct video or progressive stream check
  if (info.directVideo) {
    const res = {
      success: true,
      downloadUrl: info.directVideo,
      filename: `${cleanTitle}_${qualityStr}p.${ext}`,
      title: info.title || 'High Definition Media',
      duration: info.durationLabel || 'HD',
      thumbnail: info.thumbnail,
      quality: `${qualityStr}p`,
      type: type,
      isGateway: false
    };
    setCache(cacheKey, res);
    return res;
  }

  // Check progressive formats from info if available
  if (info.video_formats && Array.isArray(info.video_formats)) {
    const matchFmt = info.video_formats.find(f => String(f.quality) === String(qualityStr) && f.url) ||
                     info.video_formats.find(f => f.url);
    if (matchFmt && matchFmt.url) {
      const res = {
        success: true,
        downloadUrl: matchFmt.url,
        filename: `${cleanTitle}_${qualityStr}p.${ext}`,
        title: info.title || 'High Definition Media',
        duration: info.durationLabel || 'HD',
        thumbnail: info.thumbnail,
        quality: `${qualityStr}p`,
        type: type,
        isGateway: false
      };
      setCache(cacheKey, res);
      return res;
    }
  }

  throw new Error('Direct media stream not available for this link. Please check if the video is public.');
}

// -------------------------------------------------------------
// HTTP SERVER
// -------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  let reqPath = parsedUrl.pathname;

  if (reqPath === '/') {
    reqPath = '/index.html';
  } else if (reqPath === '/news') {
    reqPath = '/news.html';
  }

  // Health check endpoint
  if (reqPath === '/healthz' || reqPath === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
    return;
  }

  // -----------------------------------------------------------
  // API: DIRECT APK DOWNLOAD ROUTE WITH ATTACHMENT HEADERS
  // -----------------------------------------------------------
  if (reqPath === '/download-apk' || reqPath === '/api/download-apk' || reqPath === '/YT_Download.apk' || reqPath === '/app-debug.apk') {
    const candidatePaths = [
      path.join(__dirname, '.build-outputs', 'app-debug.apk'),
      path.join(__dirname, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'),
      path.join(PUBLIC_DIR, 'YT_Download.apk')
    ];

    let apkPath = candidatePaths.find(p => fs.existsSync(p));

    if (!apkPath) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end('APK file is currently being built or was not found. Please try again in a moment.');
      return;
    }

    const stat = fs.statSync(apkPath);
    const headers = {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Length': stat.size,
      'Content-Disposition': 'attachment; filename="YT_Download.apk"',
      'X-Content-Type-Options': 'nosniff',
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

  // -----------------------------------------------------------
  // API: RECENT GOOGLE NEWS (UPDATED DAILY AUTOMATICALLY)
  // -----------------------------------------------------------
  if (reqPath === '/api/news') {
    const queryCategory = (parsedUrl.query.category || 'all').toLowerCase();
    const forceRefresh = parsedUrl.query.refresh === '1' || parsedUrl.query.force === 'true';

    try {
      if (forceRefresh) {
        await refreshGoogleNews(true);
      }

      let filteredArticles = newsState.articles;
      if (queryCategory && queryCategory !== 'all') {
        filteredArticles = newsState.articles.filter(a => a.category === queryCategory);
      }

      // Recompute timeAgo dynamically relative to current request time and guarantee imageUrl
      const articlesWithDynamicTime = filteredArticles.map(a => {
        let favicon = a.sourceFavicon;
        if (!favicon && a.sourceUrl) {
          try {
            const host = new URL(a.sourceUrl).hostname.replace(/^www\./, '');
            favicon = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
          } catch (e) {
            favicon = 'https://www.google.com/s2/favicons?domain=news.google.com&sz=64';
          }
        }
        return {
          ...a,
          imageUrl: a.imageUrl || getRelatedNewsImage(a.title, a.category),
          sourceFavicon: favicon || 'https://www.google.com/s2/favicons?domain=news.google.com&sz=64',
          snippet: cleanGoogleNewsSnippet(a.snippet, a.title),
          timeAgo: formatRelativeTime(new Date(a.pubDate))
        };
      });

      const nextUpdateDate = newsState.lastUpdated
        ? new Date(new Date(newsState.lastUpdated).getTime() + 24 * 60 * 60 * 1000)
        : null;

      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300'
      });
      res.end(JSON.stringify({
        success: true,
        source: 'Google News',
        updateFrequency: 'Daily (Automatic)',
        lastUpdated: newsState.lastUpdated,
        nextScheduledUpdate: nextUpdateDate ? nextUpdateDate.toISOString() : null,
        totalArticles: articlesWithDynamicTime.length,
        selectedCategory: queryCategory,
        categories: newsState.categories,
        articles: articlesWithDynamicTime
      }));
    } catch (newsErr) {
      console.error('[News API Error]', newsErr.message);
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: false, error: newsErr.message }));
    }
    return;
  }

  // -----------------------------------------------------------
  // API: ANALYZE VIDEO
  // -----------------------------------------------------------
  if (reqPath === '/api/analyze') {
    const videoUrl = parsedUrl.query.url;
    if (!videoUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: false, error: 'Missing url parameter' }));
      return;
    }

    try {
      const { info, normalizedUrl } = await fetchVideoInfo(videoUrl);

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
          normalizedUrl
        }
      }));
    } catch (err) {
      console.error('Analyze error:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({
        success: false,
        error: err.message || 'Could not analyze video. Please verify the URL and try again.'
      }));
    }
    return;
  }

  // -----------------------------------------------------------
  // API: GENERATE DOWNLOAD LINK / RESOLVE STREAM (ULTRA-FAST)
  // -----------------------------------------------------------
  if (reqPath === '/api/download' || reqPath === '/api/resolve') {
    const videoUrl = parsedUrl.query.url;
    const quality = parsedUrl.query.quality || '720';
    const type = parsedUrl.query.type || 'video';

    if (!videoUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: false, error: 'Missing url parameter' }));
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
      console.error('Download/resolve link error:', err.message);
      const normalized = normalizeVideoUrl(videoUrl);
      const ytMatch = normalized.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
      const ytId = ytMatch ? ytMatch[1] : null;
      const fallbackUrl = ytId
        ? `https://en.ssyoutube.com/watch?v=${ytId}`
        : `https://en.savefrom.net/398/#url=${encodeURIComponent(videoUrl)}`;

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({
        success: true,
        downloadUrl: fallbackUrl,
        filename: `video_${quality}p.${type === 'audio' ? 'mp3' : 'mp4'}`,
        title: 'High Definition Media',
        quality: `${quality}p`,
        type: type,
        isGateway: true
      }));
    }
    return;
  }

  // -----------------------------------------------------------
  // API: 1-CLICK INSTANT FAST DOWNLOAD (DIRECT ATTACHMENT)
  // -----------------------------------------------------------
  if (reqPath === '/api/fast-download') {
    const videoUrl = parsedUrl.query.url;
    const quality = parsedUrl.query.quality || '720';
    const type = parsedUrl.query.type || 'video';

    if (!videoUrl) {
      res.writeHead(400, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
      res.end('Missing url parameter');
      return;
    }

    try {
      const { info, cdn } = await fetchVideoInfo(videoUrl);
      const downloadData = await requestDownloadLink(cdn, info, quality, type);

      if (downloadData && downloadData.downloadUrl) {
        if (downloadData.downloadUrl.startsWith('http') && !downloadData.isGateway) {
          const proxyRedirect = `/api/proxy?url=${encodeURIComponent(downloadData.downloadUrl)}&filename=${encodeURIComponent(downloadData.filename)}&type=${type}`;
          res.writeHead(302, { 'Location': proxyRedirect });
          res.end();
          return;
        } else if (downloadData.downloadUrl.startsWith('http')) {
          res.writeHead(302, { 'Location': downloadData.downloadUrl });
          res.end();
          return;
        }
      }
    } catch (e) {
      console.warn('Fast download error:', e.message);
    }

    res.writeHead(302, { 'Location': `https://en.savefrom.net/398/#url=${encodeURIComponent(videoUrl)}` });
    res.end();
    return;
  }

  // -----------------------------------------------------------
  // API: STREAM PROXY WITH ATTACHMENT DISPOSITION
  // -----------------------------------------------------------
  if (reqPath === '/api/proxy' || reqPath === '/api/stream') {
    const targetUrl = parsedUrl.query.url;
    const filename = parsedUrl.query.filename || 'download.mp4';
    const type = parsedUrl.query.type || 'video';
    const contentType = type === 'audio' ? 'audio/mpeg' : 'video/mp4';

    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
      res.end('Missing url query');
      return;
    }

    try {
      const isTiktok = targetUrl.includes('tiktok') || targetUrl.includes('tikwm');
      const isYt = targetUrl.includes('googlevideo') || targetUrl.includes('savetube');
      const reqHeaders = {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36'
      };
      if (isTiktok) {
        reqHeaders['Referer'] = 'https://www.tiktok.com/';
      } else if (isYt) {
        reqHeaders['Referer'] = 'https://save-tube.com/';
      }

      const proxyRes = await fetch(targetUrl, {
        headers: reqHeaders,
        redirect: 'follow'
      });

      if (!proxyRes.ok || !proxyRes.body) {
        throw new Error(`Proxy target error: HTTP ${proxyRes.status}`);
      }

      const cleanAscii = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      const responseHeaders = {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${cleanAscii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache'
      };

      const contentLength = proxyRes.headers.get('content-length');
      if (contentLength) {
        responseHeaders['Content-Length'] = contentLength;
      }

      res.writeHead(200, responseHeaders);

      const nodeStream = Readable.fromWeb(proxyRes.body);
      nodeStream.on('error', (e) => console.error('[Proxy Stream Error]', e.message));
      nodeStream.pipe(res);
      return;
    } catch (err) {
      console.error('Proxy stream error:', err.message);
      if (!res.headersSent) {
        res.writeHead(302, { 'Location': targetUrl });
        res.end();
      }
      return;
    }
  }

  // -----------------------------------------------------------
  // STATIC FILES HANDLING
  // -----------------------------------------------------------
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
      // If asking for /news or not found, fallback appropriately
      const fallbackFile = reqPath.includes('news') ? 'news.html' : 'index.html';
      const fallbackPath = path.join(PUBLIC_DIR, fallbackFile);
      fs.readFile(fallbackPath, (readErr, content) => {
        if (readErr) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('404 Not Found');
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(content);
        }
      });
      return;
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const headers = {
      'Content-Type': contentType,
      'Cache-Control': ext === '.apk' ? 'no-cache, no-store, must-revalidate' : 'public, max-age=3600'
    };

    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    if (urlObj.searchParams.get('download') === '1' || ext === '.apk') {
      const downloadFilename = urlObj.searchParams.get('filename') || path.basename(resolvedPath);
      headers['Content-Disposition'] = `attachment; filename="${downloadFilename}"`;
    }

    res.writeHead(200, headers);
    const stream = fs.createReadStream(resolvedPath);
    stream.on('error', (e) => console.error('[Static Stream Error]', e.message));
    stream.pipe(res);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`YT Download & Google News server running live on port ${PORT}`);
});
