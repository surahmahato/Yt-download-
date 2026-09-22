const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const vm = require('vm');
const { createDecipheriv } = require('crypto');
const { Readable } = require('stream');
const { execFile, execSync } = require('child_process');

let vredenScraper = null;
try {
  vredenScraper = require('@vreden/youtube_scraper');
} catch (e) {
  console.warn('[@vreden/youtube_scraper load warning]:', e.message);
}

let cakkatrokDownloader = null;
try {
  cakkatrokDownloader = require('cakkatrok-instagram-downloader');
} catch (e) {
  console.warn('[cakkatrok load warning]:', e.message);
}

const YT_DLP_BIN = fs.existsSync(path.join(__dirname, 'bin', 'yt-dlp'))
  ? path.join(__dirname, 'bin', 'yt-dlp')
  : (fs.existsSync('/usr/local/bin/yt-dlp') ? '/usr/local/bin/yt-dlp' : 'yt-dlp');

// Ensure local yt-dlp binary has executable permissions
try {
  if (fs.existsSync(YT_DLP_BIN)) {
    fs.chmodSync(YT_DLP_BIN, 0o755);
  }
} catch (e) {
  console.warn('[yt-dlp chmod warning]:', e.message);
}

const NODE_BIN = process.execPath || '/usr/local/bin/node';

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

// Garbage-collect expired rate limit records periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of ipRateLimits.entries()) {
    if (now - record.startTime > 120000) {
      ipRateLimits.delete(ip);
    }
  }
}, 300000);

// Strict SSRF & safe URL validation
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
    // Block IPv4 private/loopback/cloud metadata ranges
    const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4Match) {
      const a = Number(ipv4Match[1]);
      const b = Number(ipv4Match[2]);
      if (a === 127 || a === 0) return false; // Loopback
      if (a === 10) return false; // 10.0.0.0/8
      if (a === 172 && b >= 16 && b <= 31) return false; // 172.16.0.0/12
      if (a === 192 && b === 168) return false; // 192.168.0.0/16
      if (a === 169 && b === 254) return false; // 169.254.0.0/16 Link-local/metadata
      if (a >= 224) return false; // Multicast/reserved
    }
    // Block IPv6 formats
    if (hostname.includes(':') || hostname.startsWith('[') || hostname === '::1') {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function sanitizeAndValidateUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (trimmed.length > 2048) return null; // Prevent buffer/ReDoS attacks
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) return null;
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

// Intelligent duplicate detection across news syndications and feeds
function areHeadlinesDuplicates(titleA, titleB) {
  if (!titleA || !titleB) return false;

  const cleanA = titleA.toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanB = titleB.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (cleanA === cleanB) return true;
  if (cleanA.length > 25 && cleanB.length > 25) {
    if (cleanA.includes(cleanB) || cleanB.includes(cleanA)) return true;
  }

  const stopWords = new Set([
    'this', 'that', 'with', 'from', 'have', 'were', 'what', 'when', 'where', 'which', 'about',
    'after', 'will', 'more', 'than', 'their', 'there', 'been', 'over', 'into', 'just', 'also',
    'amid', 'news', 'live', 'says', 'said', 'report', 'reports', 'update', 'updates', 'video',
    'watch', 'exclusive', 'breaking', 'look', 'first', 'here', 'could', 'would', 'should'
  ]);

  const getTokens = (str) => str.toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w));

  const tokensA = getTokens(titleA);
  const tokensB = getTokens(titleB);

  if (tokensA.length >= 3 && tokensB.length >= 3) {
    const setB = new Set(tokensB);
    const common = tokensA.filter(w => setB.has(w));
    const minLen = Math.min(tokensA.length, tokensB.length);
    const similarity = common.length / minLen;

    // Over 50% keyword overlap means it is coverage of the exact same news story
    if (similarity >= 0.5) return true;

    // First 3 significant words match in sequence
    if (tokensA.slice(0, 3).join(' ') === tokensB.slice(0, 3).join(' ')) return true;
  }

  return false;
}

// Clean HTML and extract full story description and structured highlights from Google News RSS
function parseGoogleNewsDescription(rawDesc, fallbackTitle, source) {
  if (!rawDesc) {
    return {
      snippet: fallbackTitle || 'Read the full coverage on Google News.',
      fullDescription: `${fallbackTitle}.\n\nDetailed reporting provided by ${source || 'verified news publishers'}. Tap the link below to access the full news article and ongoing developments.`,
      relatedSources: []
    };
  }

  // Unescape HTML entities
  let decoded = rawDesc
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ');

  // Extract all individual article points / headlines packaged by Google News
  const listItems = [];
  const liMatches = decoded.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi);
  for (const m of liMatches) {
    const liContent = m[1];
    const liText = liContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (liText && liText.length > 6) {
      listItems.push(liText);
    }
  }

  // Strip all HTML tags
  let cleanText = decoded.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  let snippet = listItems.length > 0 ? listItems[0] : cleanText;
  if (!snippet || snippet.length < 15 || snippet.startsWith('http')) {
    snippet = fallbackTitle || 'Read the full verified story and coverage on Google News.';
  }

  let fullDescription = '';
  if (listItems.length > 1) {
    fullDescription = listItems.map(item => `• ${item}`).join('\n\n');
  } else if (cleanText.length > 40) {
    fullDescription = cleanText;
  } else {
    fullDescription = `${fallbackTitle}.\n\nFull breaking news story and context provided by ${source || 'Google News'}. Tap the original link below to view complete press statements, analysis, and multimedia reports.`;
  }

  return {
    snippet: snippet.substring(0, 240),
    fullDescription,
    relatedSources: listItems
  };
}

// Clean and sanitize Google News snippets for cards
function cleanGoogleNewsSnippet(snippet, title) {
  if (!snippet) return title || 'Read the full coverage on Google News.';
  // Strip all HTML tags and normalize spacing
  let clean = snippet.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  clean = cleanHtml(clean);
  if (title && clean.startsWith(title)) {
    clean = clean.substring(title.length).replace(/^[\s:;,-]+/, '').trim();
  }
  if (!clean || clean.length < 10) {
    return title || 'Read the full verified story and coverage on Google News.';
  }
  return clean.substring(0, 240);
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

    const { snippet, fullDescription, relatedSources } = parseGoogleNewsDescription(desc, title, source);
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
        snippet,
        fullDescription,
        relatedSources
      });
    }
  }
  return items;
}

// Update News from Google News (Auto-refreshes every 20 minutes)
const NEWS_REFRESH_INTERVAL_MS = 20 * 60 * 1000; // 20 minutes

async function refreshGoogleNews(force = false) {
  if (!force && newsState.lastUpdated) {
    const elapsed = Date.now() - new Date(newsState.lastUpdated).getTime();
    if (elapsed < NEWS_REFRESH_INTERVAL_MS && newsState.articles.length > 0) {
      return newsState;
    }
  }

  if (newsState.isUpdating) {
    return newsState;
  }

  newsState.isUpdating = true;
  console.log('[Google News] Fetching fresh news update from Google (20-min cycle)...');

  try {
    const allArticles = [];

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
            // Check intelligent duplicate match
            const isDuplicate = allArticles.some(existing => areHeadlinesDuplicates(existing.title, item.title));
            if (!isDuplicate) {
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

      console.log(`[Google News] Successfully updated ${allArticles.length} recent articles. Next update in 20 minutes.`);
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
        const uniqueArticles = [];
        for (const rawArticle of saved.articles) {
          const article = { ...rawArticle };
          if (!article.imageUrl) {
            article.imageUrl = getRelatedNewsImage(article.title, article.category);
          }
          if (!article.sourceFavicon && article.sourceUrl) {
            try {
              const dom = new URL(article.sourceUrl).hostname.replace(/^www\./, '');
              article.sourceFavicon = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(dom)}&sz=64`;
            } catch (e) {}
          }
          if (!article.fullDescription) {
            const parsed = parseGoogleNewsDescription(article.snippet, article.title, article.source);
            article.snippet = parsed.snippet;
            article.fullDescription = parsed.fullDescription;
          }

          // Deduplicate
          const isDuplicate = uniqueArticles.some(existing => areHeadlinesDuplicates(existing.title, article.title));
          if (!isDuplicate) {
            uniqueArticles.push(article);
          }
        }
        newsState.articles = uniqueArticles;
        newsState.lastUpdated = saved.lastUpdated;
        console.log(`[Google News] Loaded and deduplicated ${uniqueArticles.length} cached articles with related images (Updated: ${saved.lastUpdated})`);
      }
    }
  } catch (e) {
    console.warn('[Google News] Failed to load cache file:', e.message);
  }

  // Initial fetch or refresh
  refreshGoogleNews().catch(err => console.error('[Google News] Startup fetch error:', err.message));

  // Schedule automatic update check every 20 minutes
  setInterval(() => {
    refreshGoogleNews(false).catch(err => console.error('[Google News] Periodic check error:', err.message));
  }, 20 * 60 * 1000);
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

// -------------------------------------------------------------
// UNIVERSAL VIDEO & STREAM EXTRACTION ENGINE
// -------------------------------------------------------------

function extractWithYtDlp(url, quality = '720', type = 'video') {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(YT_DLP_BIN)) {
      return reject(new Error('yt-dlp binary not available'));
    }
    const qNum = parseInt(quality, 10) || 720;
    const formatArg = type === 'audio'
      ? 'bestaudio[ext=m4a]/bestaudio/best'
      : `best[height<=${qNum}][ext=mp4]/18/best[ext=mp4]/best`;

    // Strategy 1: Rich JSON metadata extraction
    const jsonArgs = [
      '--js-runtimes', `node:${NODE_BIN}`,
      '--no-playlist',
      '--no-warnings',
      '--dump-single-json',
      url
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
              // Look for combined audio+video progressive MP4 format
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
        } catch (pe) {
          // JSON parsing failed, proceed to fallback
        }
      }

      // Strategy 2: Direct stream extraction via -g
      const gArgs = [
        '--js-runtimes', `node:${NODE_BIN}`,
        '--no-playlist',
        '--no-warnings',
        '-g',
        '-f', formatArg,
        url
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

async function extractTikTok(url) {
  // Method 1: TikWM API (Fastest & most reliable)
  try {
    const tikRes = await fetchJson(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`, {
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

  // Method 2: TikMate API
  try {
    const postBody = new URLSearchParams({ url }).toString();
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

  // Method 3: yt-dlp fallback
  try {
    const ytRes = await extractWithYtDlp(url, '720', 'video');
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

async function extractInstagram(url, quality = '720', type = 'video') {
  // Method 1: SaveIG (saveig.to) API with safe VM script decoding
  try {
    const homeRes = await fetch('https://saveig.to/en', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      signal: AbortSignal.timeout(6000)
    });
    const html = await homeRes.text();
    const expMatch = html.match(/k_exp="([^"]+)"/);
    const tokenMatch = html.match(/k_token="([^"]+)"/);
    if (expMatch && tokenMatch) {
      const searchRes = await fetch('https://saveig.to/api/ajaxSearch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Origin': 'https://saveig.to',
          'Referer': 'https://saveig.to/en',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: new URLSearchParams({
          k_exp: expMatch[1],
          k_token: tokenMatch[1],
          q: url,
          t: 'media',
          lang: 'en',
          v: 'v2'
        }).toString(),
        signal: AbortSignal.timeout(8000)
      });
      const data = await searchRes.json();
      if (data && data.data) {
        let decodedHtml = '';
        const mockElem = { set innerHTML(val) { decodedHtml += val; }, get innerHTML() { return decodedHtml; } };
        const sandbox = {
          document: { getElementById: () => mockElem, querySelector: () => mockElem, querySelectorAll: () => [mockElem] },
          window: { location: { hostname: 'saveig.to', href: 'https://saveig.to/en' } },
          location: { hostname: 'saveig.to', href: 'https://saveig.to/en' },
          console: { log: () => {} }
        };
        vm.createContext(sandbox);
        try {
          vm.runInContext(data.data, sandbox, { timeout: 3000 });
        } catch (ve) {
          decodedHtml = data.data;
        }

        const hrefs = [...decodedHtml.matchAll(/href=["']([^"']+)["']/g)].map(m => m[1]);
        const snapLinks = hrefs.filter(h => h.includes('dl.snapcdn.app') || h.includes('instagram.com') || h.includes('fbcdn.net'));
        const thumbMatch = decodedHtml.match(/<img[^>]+src=["']([^"']+)["']/i);
        const thumb = thumbMatch ? thumbMatch[1] : '';

        if (snapLinks.length > 0) {
          const directDl = snapLinks[0];
          let filename = 'instagram_media.mp4';
          const tokenParam = directDl.match(/[?&]token=([^&]+)/);
          if (tokenParam) {
            try {
              const payload = JSON.parse(Buffer.from(tokenParam[1].split('.')[1], 'base64').toString());
              if (payload.filename) filename = payload.filename;
            } catch (e) {}
          }
          const isPhoto = /\.(jpg|jpeg|png|webp)/i.test(filename) || /\.(jpg|jpeg|png|webp)/i.test(directDl);
          return {
            downloadUrl: directDl,
            title: filename.replace(/\.[^/.]+$/, '').replace(/_/g, ' ') || 'Instagram Media',
            thumbnail: thumb || directDl,
            duration: 30,
            durationLabel: '00:30',
            author: 'Instagram Creator',
            platform: 'Instagram',
            quality: isPhoto ? 'Original HD' : `${quality}p`,
            type: isPhoto ? 'photo' : (type === 'audio' ? 'audio' : 'video')
          };
        }
      }
    }
  } catch (e) {
    console.warn('[SaveIG extract error]:', e.message);
  }

  // Method 2: cakkatrokDownloader (snapvideo.app integration)
  if (cakkatrokDownloader) {
    try {
      const res = await cakkatrokDownloader(url);
      if (res && Array.isArray(res.media) && res.media.length > 0) {
        const primary = res.media.find(m => m.type === 'video') || res.media[0];
        const isPhoto = primary.type === 'photo' || /\.(jpg|jpeg|png|webp)/i.test(primary.url);
        return {
          downloadUrl: primary.url,
          title: primary.filename ? primary.filename.replace(/\.[^/.]+$/, '').replace(/_/g, ' ') : 'Instagram Media',
          thumbnail: (res.media.find(m => m.type === 'photo') || primary).url,
          duration: 30,
          durationLabel: '00:30',
          author: 'Instagram Creator',
          platform: 'Instagram',
          quality: isPhoto ? 'Original HD' : `${quality}p`,
          type: isPhoto ? 'photo' : (type === 'audio' ? 'audio' : 'video')
        };
      }
    } catch (e) {
      console.warn('[cakkatrok extract error]:', e.message);
    }
  }

  // Method 3: SnapVideo direct API
  try {
    const snapHome = await fetch('https://snapvideo.app/en', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(6000)
    });
    const sHtml = await snapHome.text();
    const exp = sHtml.match(/k_exp="([^"]+)"/);
    const token = sHtml.match(/k_token="([^"]+)"/);
    if (exp && token) {
      const snapRes = await fetch('https://snapvideo.app/api/ajaxSearch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Origin': 'https://snapvideo.app',
          'Referer': 'https://snapvideo.app/en',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        body: new URLSearchParams({
          k_exp: exp[1],
          k_token: token[1],
          q: url,
          t: 'media',
          lang: 'en'
        }).toString(),
        signal: AbortSignal.timeout(8000)
      });
      const sData = await snapRes.json();
      if (sData && sData.data) {
        const hrefs = [...String(sData.data).matchAll(/href=["']([^"']+)["']/g)].map(m => m[1]);
        const links = hrefs.filter(h => h.includes('snapcdn.app') || h.includes('instagram.com') || h.includes('fbcdn.net'));
        if (links.length > 0) {
          return {
            downloadUrl: links[0],
            title: 'Instagram Media',
            thumbnail: links[0],
            duration: 30,
            durationLabel: '00:30',
            author: 'Instagram Creator',
            platform: 'Instagram',
            quality: `${quality}p`,
            type: type
          };
        }
      }
    }
  } catch (e) {}

  // Method 4: yt-dlp fallback
  try {
    const ytdlRes = await extractWithYtDlp(url, quality, type);
    if (ytdlRes && ytdlRes.downloadUrl) {
      return {
        ...ytdlRes,
        platform: 'Instagram'
      };
    }
  } catch (e) {}

  return null;
}

async function extractFacebook(url, quality = '720', type = 'video') {
  // Method 1: yt-dlp (Fast, robust, direct fbcdn mp4 streams)
  try {
    const ytdlRes = await extractWithYtDlp(url, quality, type);
    if (ytdlRes && ytdlRes.downloadUrl) {
      return {
        ...ytdlRes,
        platform: 'Facebook'
      };
    }
  } catch (e) {
    console.warn('[Facebook yt-dlp warning]:', e.message);
  }

  // Method 2: Public Facebook page parser
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      signal: AbortSignal.timeout(8000)
    });
    if (res.ok) {
      const html = await res.text();
      const hdMatch = html.match(/(?:browser_native_hd_url|playable_url_quality_hd)["']?\s*:\s*["'](https:[^"']+)["']/i);
      const sdMatch = html.match(/(?:browser_native_sd_url|playable_url)["']?\s*:\s*["'](https:[^"']+)["']/i);
      const targetMatch = (quality === '1080' || quality === '720' ? (hdMatch || sdMatch) : (sdMatch || hdMatch));
      if (targetMatch && targetMatch[1]) {
        const raw = targetMatch[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
        const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
        const thumbMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
        return {
          downloadUrl: raw,
          title: titleMatch ? titleMatch[1].replace(/\s*\|\s*Facebook/i, '').trim() : 'Facebook Video',
          thumbnail: thumbMatch ? thumbMatch[1] : '',
          duration: 60,
          durationLabel: '01:00',
          author: 'Facebook Creator',
          platform: 'Facebook',
          quality: hdMatch ? 'HD' : 'SD',
          type: type
        };
      }
    }
  } catch (e) {
    console.warn('[Facebook page scraper warning]:', e.message);
  }

  return null;
}

async function extractYouTube(url, quality = '720', type = 'video') {
  // Method 1: @vreden/youtube_scraper (Under 1 second, SaveTube VIP CDN)
  if (vredenScraper) {
    try {
      if (type === 'audio' && typeof vredenScraper.ytmp3 === 'function') {
        const mp3Res = await vredenScraper.ytmp3(url);
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
        const mp4Res = await vredenScraper.ytmp4(url);
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

  // Method 2: SaveTube API direct
  try {
    const normalizedUrl = normalizeVideoUrl(url);
    const cdnRes = await fetchJson('https://media.savetube.vip/api/random-cdn', { timeout: 5000 });
    const cdn = cdnRes && cdnRes.cdn ? cdnRes.cdn : 'cdn403.savetube.vip';
    const infoRes = await postJson(`https://${cdn}/v2/info`, { url: normalizedUrl }, {
      headers: { 'Referer': 'https://save-tube.com/', 'User-Agent': 'Mozilla/5.0' },
      timeout: 6000
    });
    if (infoRes && infoRes.data) {
      const info = decodeSavetubeData(infoRes.data);
      const dlRes = await postJson(`https://${cdn}/download`, {
        downloadType: type === 'audio' ? 'audio' : 'video',
        quality: quality.toString(),
        key: info.key
      }, {
        headers: { 'Referer': 'https://save-tube.com/', 'User-Agent': 'Mozilla/5.0' },
        timeout: 8000
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
          quality: `${quality}p`,
          type: type
        };
      }
    }
  } catch (se) {
    console.warn('[SaveTube direct warning]:', se.message);
  }

  // Method 3: Invidious public instances
  const ytMatch = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/) || url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/) || url.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
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

  // Method 4: yt-dlp fallback
  try {
    const ytdlRes = await extractWithYtDlp(url, quality, type);
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

  // Tier 1: Direct media stream or file (.mp4, .webm, .mkv, .mov, .mp3, etc.)
  if (/\.(mp4|webm|mkv|mov|avi|flv|m4v|mp3|m4a|wav|aac)(\?.*)?$/i.test(cleanUrl) || cleanUrl.includes('.googlevideo.com/videoplayback')) {
    const filenameSegment = cleanUrl.split('?')[0].split('/').pop() || 'media_video.mp4';
    const isAudio = /\.(mp3|m4a|wav|aac)$/i.test(filenameSegment) || type === 'audio';
    const cleanTitle = filenameSegment.replace(/[^a-zA-Z0-9._-]/g, ' ').replace(/\.[^/.]+$/, '').trim() || 'Media Video';
    return {
      downloadUrl: cleanUrl,
      title: cleanTitle,
      thumbnail: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&auto=format&fit=crop&q=80',
      duration: 120,
      durationLabel: '02:00',
      author: 'Direct Media Source',
      platform: 'Direct Stream',
      quality: isAudio ? '320kbps' : `${quality}p`,
      type: isAudio ? 'audio' : 'video'
    };
  }

  // Tier 2: Instagram Reels, Posts, Stories, IGTV
  const isInstagram = cleanUrl.toLowerCase().includes('instagram.com');
  if (isInstagram) {
    const ig = await extractInstagram(cleanUrl, quality, type);
    if (ig && ig.downloadUrl) {
      return ig;
    }
  }

  // Tier 3: TikTok videos & audio (watermark-free)
  const isTikTok = cleanUrl.toLowerCase().includes('tiktok.com');
  if (isTikTok) {
    const tt = await extractTikTok(cleanUrl);
    if (tt && (tt.directVideo || tt.directAudio)) {
      return {
        downloadUrl: type === 'audio' && tt.directAudio ? tt.directAudio : tt.directVideo,
        title: tt.title,
        thumbnail: tt.thumbnail || 'https://images.unsplash.com/photo-1611162617474-5b21e879e113?w=600&auto=format&fit=crop&q=80',
        duration: tt.duration,
        durationLabel: tt.durationLabel,
        author: tt.author,
        platform: 'TikTok',
        quality: type === 'audio' ? 'MP3' : 'HD',
        type: type
      };
    }
  }

  // Tier 4: YouTube Videos, Shorts, Audio
  const isYouTube = cleanUrl.includes('youtube.com') || cleanUrl.includes('youtu.be');
  if (isYouTube) {
    const yt = await extractYouTube(cleanUrl, quality, type);
    if (yt && yt.downloadUrl) {
      return yt;
    }
  }

  // Tier 5: Facebook Videos & Reels
  const isFacebook = cleanUrl.includes('facebook.com') || cleanUrl.includes('fb.watch') || cleanUrl.includes('fb.gg');
  if (isFacebook) {
    const fb = await extractFacebook(cleanUrl, quality, type);
    if (fb && fb.downloadUrl) {
      return fb;
    }
  }

  // Tier 6: Multi-platform yt-dlp Extractor (Twitter/X, Reddit, Vimeo, Dailymotion, Soundcloud, Pinterest, Twitch, Threads, etc.)
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

  // Tier 7: Universal OpenGraph, JSON-LD & HTML5 Video Scraper (Any public video website)
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

      // Tier 8: Universal Fail-Safe — never reject a valid public web page
      if (pageThumb || pageTitle) {
        return {
          downloadUrl: pageThumb || cleanUrl,
          title: pageTitle,
          thumbnail: pageThumb,
          duration: 60,
          durationLabel: '01:00',
          author: 'Online Creator',
          platform: 'Social Media',
          quality: `${quality}p`,
          type: type
        };
      }
    }
  } catch (he) {
    console.warn('[HTML Scraper warning]:', he.message);
  }

  // Universal Fallback if no network scraper could connect
  return {
    downloadUrl: cleanUrl,
    title: 'Social Media Video',
    thumbnail: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&auto=format&fit=crop&q=80',
    duration: 60,
    durationLabel: '01:00',
    author: 'Creator',
    platform: 'Web Video',
    quality: `${quality}p`,
    type: type
  };
}

async function fetchVideoInfo(rawUrl) {
  const cached = getCached(`info_${rawUrl}`);
  if (cached) {
    return cached;
  }

  const isTikTok = rawUrl.toLowerCase().includes('tiktok.com');
  const isInstagram = rawUrl.toLowerCase().includes('instagram.com');
  const isYouTube = rawUrl.includes('youtube.com') || rawUrl.includes('youtu.be');

  // Attempt universal extraction for instant metadata and stream caching
  try {
    const extracted = await extractUniversalVideo(rawUrl, '720', 'video');
    if (extracted) {
      const result = {
        info: {
          id: `media_${Date.now()}`,
          title: extracted.title || 'Video Media',
          thumbnail: extracted.thumbnail || (isInstagram ? 'https://images.unsplash.com/photo-1611262588024-d12430b98920?w=600&auto=format&fit=crop&q=80' : 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&auto=format&fit=crop&q=80'),
          duration: extracted.duration || 60,
          durationLabel: extracted.durationLabel || '01:00',
          directVideo: extracted.downloadUrl,
          author: extracted.author || 'Creator',
          platform: extracted.platform || (isYouTube ? 'YouTube' : (isTikTok ? 'TikTok' : (isInstagram ? 'Instagram' : 'Web Video'))),
          key: `key_${Date.now()}`,
          isSocial: !isYouTube,
          originalUrl: rawUrl
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

  // Fast YouTube oEmbed metadata fallback
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
        originalUrl: rawUrl
      },
      cdn: 'universal',
      normalizedUrl: rawUrl
    };
    setCache(`info_${rawUrl}`, result);
    return result;
  }

  // Generic fallback info
  const fallbackInfo = {
    info: {
      id: `media_${Date.now()}`,
      title: isInstagram ? 'Instagram Video Reel' : (isTikTok ? 'TikTok Video' : 'Online Video Stream'),
      thumbnail: isInstagram ? 'https://images.unsplash.com/photo-1611262588024-d12430b98920?w=600&auto=format&fit=crop&q=80' : 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&auto=format&fit=crop&q=80',
      duration: 60,
      durationLabel: '01:00',
      author: 'Creator',
      platform: isInstagram ? 'Instagram' : (isTikTok ? 'TikTok' : 'Web Video'),
      key: `media_${Date.now()}`,
      isSocial: true,
      originalUrl: rawUrl
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
  const ext = type === 'audio' ? 'mp3' : 'mp4';

  // If info already holds a direct video matching the request
  if (info.directVideo && type !== 'audio') {
    const res = {
      success: true,
      downloadUrl: info.directVideo,
      filename: `${cleanTitle}_${qualityStr}p.${ext}`,
      title: info.title,
      duration: info.durationLabel || 'HD',
      thumbnail: info.thumbnail,
      quality: `${qualityStr}p`,
      type: 'video'
    };
    setCache(cacheKey, res);
    return res;
  }

  // Call the universal multi-tier extraction engine
  const targetUrl = info.originalUrl || info.normalizedUrl || `https://www.youtube.com/watch?v=${info.id || info.key}`;
  const extracted = await extractUniversalVideo(targetUrl, qualityStr, type);

  const finalDownloadUrl = extracted.downloadUrl;
  const res = {
    success: true,
    downloadUrl: finalDownloadUrl,
    filename: `${cleanTitle}_${qualityStr}${type === 'audio' ? 'kbps' : 'p'}.${ext}`,
    title: extracted.title || info.title || 'Media Video',
    duration: extracted.durationLabel || info.durationLabel || 'HD',
    thumbnail: extracted.thumbnail || info.thumbnail,
    quality: extracted.quality || `${qualityStr}${type === 'audio' ? 'kbps' : 'p'}`,
    type: type
  };

  setCache(cacheKey, res);
  return res;
}

// -------------------------------------------------------------
// HTTP SERVER
// -------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  // Apply defensive security headers and strip server fingerprints
  applyDefensiveSecurityHeaders(res);

  const clientIp = getClientIp(req);

  // Method gating: Only allow standard HTTP methods
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

  if (reqPath === '/') {
    reqPath = '/index.html';
  } else if (reqPath === '/news') {
    reqPath = '/news.html';
  }

  // Rate Limiting (120 req/min for static pages, 40 req/min for APIs)
  const isApiReq = reqPath.startsWith('/api/');
  const maxReqs = isApiReq ? 40 : 120;
  if (!checkRateLimit(clientIp, maxReqs, 60000)) {
    res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' });
    res.end(JSON.stringify({ success: false, error: 'Rate limit exceeded. Please wait a moment.' }));
    return;
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
      if (forceRefresh || newsState.articles.length === 0) {
        await refreshGoogleNews(forceRefresh);
      }

      // If still empty, attempt to load from local cache file
      if (newsState.articles.length === 0) {
        initNewsCache();
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
        ? new Date(new Date(newsState.lastUpdated).getTime() + 20 * 60 * 1000)
        : null;

      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=60'
      });
      res.end(JSON.stringify({
        success: true,
        source: 'Google News',
        updateFrequency: 'Every 20 minutes (Automatic)',
        refreshIntervalMinutes: 20,
        refreshIntervalSeconds: 1200,
        lastUpdated: newsState.lastUpdated || new Date().toISOString(),
        nextScheduledUpdate: nextUpdateDate ? nextUpdateDate.toISOString() : null,
        totalArticles: articlesWithDynamicTime.length,
        selectedCategory: queryCategory,
        categories: newsState.categories,
        articles: articlesWithDynamicTime
      }));
    } catch (newsErr) {
      console.error('[News API Error]', newsErr.message);
      if (newsState.articles.length === 0) {
        initNewsCache();
      }
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({
        success: true,
        source: 'Google News',
        updateFrequency: 'Daily (Automatic)',
        lastUpdated: newsState.lastUpdated || new Date().toISOString(),
        totalArticles: newsState.articles.length,
        selectedCategory: queryCategory,
        categories: newsState.categories,
        articles: newsState.articles
      }));
    }
    return;
  }

  // -----------------------------------------------------------
  // API: ANALYZE VIDEO
  // -----------------------------------------------------------
  if (reqPath === '/api/analyze') {
    const rawVideoUrl = parsedUrl.query.url;
    const videoUrl = sanitizeAndValidateUrl(rawVideoUrl);
    if (!videoUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: false, error: 'Invalid or unsupported URL parameter' }));
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
        error: 'Could not analyze video. Please verify the URL and try again.'
      }));
    }
    return;
  }

  // -----------------------------------------------------------
  // API: GENERATE DOWNLOAD LINK / RESOLVE STREAM (ULTRA-FAST)
  // -----------------------------------------------------------
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
      res.writeHead(400, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({
        success: false,
        error: 'Failed to extract direct download stream for this link. Please ensure the link is public and accessible.',
        isGateway: false
      }));
    }
    return;
  }

  // -----------------------------------------------------------
  // API: 1-CLICK INSTANT FAST DOWNLOAD (DIRECT ATTACHMENT)
  // -----------------------------------------------------------
  if (reqPath === '/api/fast-download') {
    const rawVideoUrl = parsedUrl.query.url;
    const videoUrl = sanitizeAndValidateUrl(rawVideoUrl);
    const quality = parsedUrl.query.quality || '720';
    const type = parsedUrl.query.type || 'video';

    if (!videoUrl) {
      res.writeHead(400, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
      res.end('Invalid or unsupported URL parameter');
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

  // -----------------------------------------------------------
  // API: STREAM PROXY WITH ATTACHMENT DISPOSITION
  // -----------------------------------------------------------
  if (reqPath === '/api/proxy' || reqPath === '/api/stream') {
    const rawTargetUrl = parsedUrl.query.url;
    const targetUrl = sanitizeAndValidateUrl(rawTargetUrl);
    const rawFilename = parsedUrl.query.filename || 'download.mp4';
    // Strict filename sanitization against CRLF injection and path traversal
    const safeFilename = String(rawFilename).replace(/[\r\n"\\/]/g, '').trim().slice(0, 200) || 'download.mp4';
    const type = parsedUrl.query.type || 'video';
    const contentType = type === 'audio' ? 'audio/mpeg' : 'video/mp4';

    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
      res.end('Invalid or prohibited target URL');
      return;
    }

    try {
      const isTiktok = targetUrl.includes('tiktok') || targetUrl.includes('tikwm') || targetUrl.includes('nowmvideo') || targetUrl.includes('tikmate');
      const isSnap = targetUrl.includes('snapcdn') || targetUrl.includes('saveig.to');
      const isInstagram = targetUrl.includes('instagram.com') || targetUrl.includes('cdninstagram.com');
      const isFacebook = targetUrl.includes('facebook.com') || targetUrl.includes('fbcdn.net');
      const reqHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        'Accept': '*/*'
      };
      if (isTiktok) {
        reqHeaders['Referer'] = 'https://www.tiktok.com/';
      } else if (targetUrl.includes('savetube')) {
        reqHeaders['Referer'] = 'https://save-tube.com/';
      } else if (isSnap) {
        reqHeaders['Referer'] = 'https://saveig.to/';
      } else if (isInstagram) {
        reqHeaders['Referer'] = 'https://www.instagram.com/';
      } else if (isFacebook) {
        reqHeaders['Referer'] = 'https://www.facebook.com/';
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
      if (upstreamContentType.includes('image/')) {
        finalContentType = upstreamContentType;
        if (!/\.(jpg|jpeg|png|webp)$/i.test(finalFilename)) {
          finalFilename = finalFilename.replace(/\.[^/.]+$/, '') + '.jpg';
        }
      } else if (upstreamContentType.includes('audio/')) {
        finalContentType = upstreamContentType;
        if (!/\.(mp3|m4a|aac|wav)$/i.test(finalFilename)) {
          finalFilename = finalFilename.replace(/\.[^/.]+$/, '') + '.mp3';
        }
      } else if (upstreamContentType.includes('video/')) {
        finalContentType = upstreamContentType;
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

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.warn(`[Server Warning] Port ${PORT} already in use. Retrying in 1.5s...`);
    setTimeout(() => {
      try {
        server.close();
      } catch (e) {}
      server.listen(PORT, '0.0.0.0', () => {
        console.log(`YT Download & Google News server running live on port ${PORT}`);
      });
    }, 1500);
  } else {
    console.error('[Server Error]:', err.message);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`YT Download & Google News server running live on port ${PORT}`);
});
