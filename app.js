// Platform Detector & Video Downloader Engine
document.addEventListener('DOMContentLoaded', () => {
  const urlInput = document.getElementById('videoUrlInput');
  const pasteBtn = document.getElementById('pasteBtn');
  const fetchBtn = document.getElementById('fetchBtn');
  const filterTabs = document.querySelectorAll('.filter-tab');
  const resultCard = document.getElementById('videoResultCard');
  const resItemRows = document.querySelectorAll('.res-item-row');
  const downloadBtn = document.getElementById('downloadActionBtn');
  const progressBox = document.getElementById('progressBox');
  const progressBarFill = document.getElementById('progressBarFill');
  const progressPercent = document.getElementById('progressPercent');
  const progressSpeed = document.getElementById('progressSpeed');
  const progressBytes = document.getElementById('progressBytes');
  const successCard = document.getElementById('downloadSuccessCard');
  const openVideoBtn = document.getElementById('openVideoBtn');
  const headerWatchBtn = document.getElementById('headerWatchBtn');
  const shareVideoBtn = document.getElementById('shareVideoBtn');
  const downloadAgainBtn = document.getElementById('downloadAgainBtn');

  // Turbo Fast Action Elements
  const quickHdDlBtn = document.getElementById('quickHdDlBtn');
  const quickMp3DlBtn = document.getElementById('quickMp3DlBtn');
  const pasteAndGoBtn = document.getElementById('pasteAndGoBtn');
  const whileWaitPlayBtn = document.getElementById('whileWaitPlayBtn');
  const rotatingTipText = document.getElementById('rotatingTipText');
  const turboStatusStep = document.getElementById('turboStatusStep');
  const progressEta = document.getElementById('progressEta');
  const step1Dot = document.getElementById('step1Dot');
  const step1Line = document.getElementById('step1Line');
  const step2Dot = document.getElementById('step2Dot');
  const step2Line = document.getElementById('step2Line');
  const step3Dot = document.getElementById('step3Dot');

  // Video Info Elements
  const videoThumb = document.getElementById('videoThumb');
  const videoDuration = document.getElementById('videoDuration');
  const videoTitle = document.getElementById('videoTitle');
  const videoChannel = document.getElementById('videoChannel');
  const videoPlatformBadge = document.getElementById('videoPlatformBadge');
  const videoViews = document.getElementById('videoViews');

  // Video Modal Elements
  const videoPlayerModal = document.getElementById('videoPlayerModal');
  const modalBackdrop = document.getElementById('modalBackdrop');
  const closeModalBtn = document.getElementById('closeModalBtn');
  const modalCloseActionBtn = document.getElementById('modalCloseActionBtn');
  const modalYoutubeIframe = document.getElementById('modalYoutubeIframe');
  const modalVideoElement = document.getElementById('modalVideoElement');
  const modalVideoTitle = document.getElementById('modalVideoTitle');
  const modalDurationBadge = document.getElementById('modalDurationBadge');
  const modalSaveBtn = document.getElementById('modalSaveBtn');
  const directSaveFileBtn = document.getElementById('directSaveFileBtn');
  const directSaveText = document.getElementById('directSaveText');

  let currentPlatform = 'all';
  let selectedFormat = '1080';
  let selectedType = 'video';
  let currentVideoData = null;

  // Single Column Resolution Row Selection
  function initResolutionRowListeners() {
    const rows = document.querySelectorAll('.res-item-row');
    rows.forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.table-dl-btn')) return;

        rows.forEach(r => r.classList.remove('selected'));
        row.classList.add('selected');
        selectedFormat = row.getAttribute('data-quality') || '720';
        selectedType = row.getAttribute('data-type') || 'video';

        const label = selectedType === 'audio' 
          ? '⚡ Save MP3 Audio to Phone Gallery' 
          : `⚡ Save ${selectedFormat}p Video to Phone Gallery`;
        const btnText = document.getElementById('downloadBtnText');
        if (btnText) btnText.textContent = label;
      });
    });

    document.querySelectorAll('.table-dl-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const quality = btn.getAttribute('data-quality') || '720';
        const type = btn.getAttribute('data-type') || 'video';
        downloadSpecificQuality(quality, type, btn);
      });
    });
  }
  initResolutionRowListeners();

  // Clipboard Paste Button
  if (pasteBtn) {
    pasteBtn.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          urlInput.value = text.trim();
          detectPlatformFromUrl(urlInput.value);
          fetchVideoMetadata(urlInput.value);
        }
      } catch (err) {
        urlInput.focus();
      }
    });
  }

  // Filter Tabs
  filterTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      filterTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentPlatform = tab.getAttribute('data-platform');
      updateInputPlaceholder();
    });
  });

  function updateInputPlaceholder() {
    switch (currentPlatform) {
      case 'youtube':
        urlInput.placeholder = 'Paste YouTube video, Shorts, or Music link...';
        break;
      case 'tiktok':
        urlInput.placeholder = 'Paste TikTok video or sound link...';
        break;
      case 'instagram':
        urlInput.placeholder = 'Paste Instagram Reels, Stories, or Post video link...';
        break;
      default:
        urlInput.placeholder = 'Paste YouTube, TikTok, or Instagram video link here...';
    }
  }

  // Rotating Entertainment Tips & Creator Insights (No Boring Experience)
  const FUN_TIPS = [
    'Saved videos go directly into your phone\'s <strong>Gallery > Downloads</strong> album!',
    'Multi-threaded CDN stream delivers up to <strong>18.5 MB/s</strong> direct throughput.',
    'Want to watch right away? Tap <strong>▶ Play Preview</strong> above to watch without waiting!',
    'Need only the song or audio? Tap <strong>Instant MP3</strong> for crystal-clear 320kbps audio.',
    '100% full original length with synchronized sound & high-definition visuals.',
    'Shorts & Reels are saved in original full resolution with zero watermarks.'
  ];
  let tipIndex = 0;
  setInterval(() => {
    if (rotatingTipText) {
      tipIndex = (tipIndex + 1) % FUN_TIPS.length;
      rotatingTipText.innerHTML = FUN_TIPS[tipIndex];
    }
  }, 3500);

  // Background Pre-fetching on URL paste / input
  let prefetchTimer = null;
  urlInput.addEventListener('input', () => {
    const rawVal = urlInput.value.trim();
    detectPlatformFromUrl(rawVal);
    if (rawVal.startsWith('http') && (rawVal.includes('youtu') || rawVal.includes('tiktok') || rawVal.includes('instagram'))) {
      clearTimeout(prefetchTimer);
      prefetchTimer = setTimeout(() => {
        // Silently warm CDN cache in background so download is instantaneous
        fetch(`/api/resolve?url=${encodeURIComponent(rawVal)}&quality=720&type=video`).catch(() => {});
      }, 400);
    }
  });

  // 1-Click Instant Action Buttons
  if (quickHdDlBtn) {
    quickHdDlBtn.addEventListener('click', async () => {
      let url = urlInput.value.trim();
      if (!url) {
        try {
          const clipText = await navigator.clipboard.readText();
          if (clipText && clipText.startsWith('http')) {
            url = clipText.trim();
            urlInput.value = url;
            detectPlatformFromUrl(url);
          }
        } catch (e) {}
      }
      if (!url) {
        url = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
        urlInput.value = url;
      }
      await fastOneClickDownload(url, '720', 'video', quickHdDlBtn);
    });
  }

  if (quickMp3DlBtn) {
    quickMp3DlBtn.addEventListener('click', async () => {
      let url = urlInput.value.trim();
      if (!url) {
        try {
          const clipText = await navigator.clipboard.readText();
          if (clipText && clipText.startsWith('http')) {
            url = clipText.trim();
            urlInput.value = url;
            detectPlatformFromUrl(url);
          }
        } catch (e) {}
      }
      if (!url) {
        url = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
        urlInput.value = url;
      }
      await fastOneClickDownload(url, '320', 'audio', quickMp3DlBtn);
    });
  }

  if (pasteAndGoBtn) {
    pasteAndGoBtn.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text && text.trim().startsWith('http')) {
          urlInput.value = text.trim();
          detectPlatformFromUrl(urlInput.value);
          await fastOneClickDownload(urlInput.value, '720', 'video', pasteAndGoBtn);
          return;
        }
      } catch (e) {}

      if (urlInput.value.trim()) {
        await fastOneClickDownload(urlInput.value.trim(), '720', 'video', pasteAndGoBtn);
      } else {
        urlInput.focus();
      }
    });
  }

  // Interactive "While You Wait" Preview Play
  if (whileWaitPlayBtn) {
    whileWaitPlayBtn.addEventListener('click', () => {
      openVideoModal();
    });
  }

  // Sample Pills
  document.querySelectorAll('.sample-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const sampleUrl = pill.getAttribute('data-url');
      urlInput.value = sampleUrl;
      detectPlatformFromUrl(sampleUrl);
      fetchVideoMetadata(sampleUrl);
    });
  });

  // URL Change / Detection
  urlInput.addEventListener('input', () => {
    detectPlatformFromUrl(urlInput.value.trim());
  });

  function detectPlatformFromUrl(url) {
    const lower = url.toLowerCase();
    if (lower.includes('youtube.com') || lower.includes('youtu.be')) {
      setActivePlatformTab('youtube');
    } else if (lower.includes('tiktok.com')) {
      setActivePlatformTab('tiktok');
    } else if (lower.includes('instagram.com')) {
      setActivePlatformTab('instagram');
    }
  }

  function setActivePlatformTab(platform) {
    filterTabs.forEach(tab => {
      if (tab.getAttribute('data-platform') === platform) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });
    currentPlatform = platform;
  }

  // Fetch Button Click
  fetchBtn.addEventListener('click', () => {
    const url = urlInput.value.trim();
    if (!url) {
      alert('Please enter any video link to download.');
      urlInput.focus();
      return;
    }
    fetchVideoMetadata(url);
  });

  // Enter key in input
  urlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      fetchBtn.click();
    }
  });

  // Extract YouTube ID (works for regular videos and Shorts)
  function extractYouTubeId(url) {
    const shortsMatch = url.match(/\/shorts\/([a-zA-Z0-9_-]{11})/i);
    if (shortsMatch && shortsMatch[1]) return { id: shortsMatch[1], isShort: true };

    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
    const match = url.match(regex);
    if (match && match[1]) return { id: match[1], isShort: false };

    return null;
  }

  // Parse Metadata & Display with Real Backend Analyzer
  async function fetchVideoMetadata(url) {
    fetchBtn.disabled = true;
    fetchBtn.innerHTML = '<span>Analyzing link...</span>';

    let platformName = 'YouTube';
    let thumbUrl = 'https://images.unsplash.com/photo-1536240478700-b869070f9279?w=600&auto=format&fit=crop&q=80';
    let title = 'HD Playable Video';
    let channel = 'Social Media Creator';
    let duration = '01:23';
    let views = 'High Definition';
    const ytInfo = extractYouTubeId(url);

    // Initial local guess based on platform
    const lower = url.toLowerCase();
    if (lower.includes('tiktok.com')) {
      platformName = 'TikTok';
      title = 'TikTok Video (No Watermark)';
      channel = '@tiktok_creator';
    } else if (lower.includes('instagram.com')) {
      platformName = 'Instagram';
      title = 'Instagram Reel (Full HD)';
      channel = '@insta_reels';
    } else if (ytInfo) {
      platformName = ytInfo.isShort ? 'YouTube Shorts' : 'YouTube';
      thumbUrl = `https://i.ytimg.com/vi/${ytInfo.id}/hqdefault.jpg`;
      title = ytInfo.isShort ? 'YouTube Shorts Video' : 'YouTube Video';
    } else {
      platformName = 'Video Stream';
      title = 'Playable Media Stream';
      channel = 'Online Video';
    }

    // Call server analyzer endpoint for exact video title, thumbnail, duration
    try {
      const analyzeRes = await fetch(`/api/analyze?url=${encodeURIComponent(url)}`);
      if (analyzeRes.ok) {
        const analyzeData = await analyzeRes.json();
        if (analyzeData.success) {
          const v = analyzeData.video || analyzeData;
          if (v.title) title = v.title;
          if (v.thumbnail) thumbUrl = v.thumbnail;
          if (v.durationLabel || v.duration) duration = v.durationLabel || v.duration;
          if (v.platform) platformName = v.platform;
          if (v.channel || v.author) channel = v.channel || v.author;
          if (v.id) {
            if (!ytInfo) {
              ytInfo = { id: v.id, isShort: false };
            } else {
              ytInfo.id = v.id;
            }
          }
          currentVideoData = {
            url,
            platform: platformName,
            thumbUrl,
            title,
            channel,
            duration,
            views,
            ytInfo,
            type: v.type || 'video',
            isPhoto: !!v.isPhoto,
            photos: v.photos || []
          };
          renderResolutionOptions(v);
        }
      }
    } catch (err) {
      console.warn('Backend analyze fallback:', err.message);
    }

    // Also fallback to YouTube oEmbed if title is still default
    if (ytInfo && title.includes('YouTube Video')) {
      try {
        const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${ytInfo.id}&format=json`;
        const res = await fetch(oembedUrl);
        if (res.ok) {
          const data = await res.json();
          if (data.title) title = data.title;
          if (data.author_name) channel = data.author_name;
          if (data.thumbnail_url) thumbUrl = data.thumbnail_url;
        }
      } catch (e) {}
    }

    if (!currentVideoData) {
      currentVideoData = {
        url,
        platform: platformName,
        thumbUrl,
        title,
        channel,
        duration,
        views,
        ytInfo,
        type: 'video',
        isPhoto: false,
        photos: []
      };
      renderResolutionOptions(currentVideoData);
    }

    videoThumb.src = thumbUrl;
    videoDuration.textContent = duration;
    videoTitle.textContent = title;
    videoChannel.textContent = channel;
    videoPlatformBadge.textContent = platformName;
    videoViews.textContent = views;

    // Platform pill styling
    const badgeClass = platformName.toLowerCase().includes('tiktok') 
      ? 'tiktok' 
      : (platformName.toLowerCase().includes('instagram') ? 'instagram' : 'youtube');
    videoPlatformBadge.className = `platform-pill ${badgeClass}`;

    resultCard.style.display = 'block';
    successCard.style.display = 'none';
    progressBox.style.display = 'none';

    fetchBtn.disabled = false;
    fetchBtn.innerHTML = `
      <svg style="width:18px;height:18px;fill:currentColor" viewBox="0 0 24 24">
        <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/>
      </svg>
      <span>Download</span>
    `;

    resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Dynamically render resolution rows according to media type (Video vs High-Res Photo)
  function renderResolutionOptions(v) {
    const col = document.getElementById('resolutionSingleColumn');
    if (!col) return;
    const isPhoto = v && (v.isPhoto || v.type === 'photo');

    if (isPhoto) {
      selectedFormat = '1080';
      selectedType = 'photo';
      let html = `
        <div class="res-item-row selected" data-quality="1080" data-type="photo">
          <div class="res-left">
            <span class="res-pill pill-1080" style="background:linear-gradient(135deg, #0284c7, #0369a1);color:#fff;">HD PHOTO</span>
            <div class="res-info">
              <div class="res-headline">Original Resolution (Full HD) <span class="format-badge-chip" style="background:#e0f2fe;color:#0369a1;">JPG Image</span></div>
              <div class="res-subline">Pristine Uncompressed Quality • Direct Save to Gallery</div>
            </div>
          </div>
          <button type="button" class="btn-res-action table-dl-btn" data-quality="1080" data-type="photo">
            <svg style="width:16px;height:16px;fill:currentColor" viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
            <span>Download HD Photo</span>
          </button>
        </div>
      `;

      if (v.photos && v.photos.length > 1) {
        v.photos.forEach((p, idx) => {
          html += `
            <div class="res-item-row" data-quality="1080" data-type="photo" data-photourl="${p.downloadUrl}" data-photoname="${p.filename || ('photo_' + (idx + 1) + '.jpg')}">
              <div class="res-left">
                <span class="res-pill" style="background:#38bdf8;color:#0f172a;font-weight:700;">#${idx + 1}</span>
                <div class="res-info">
                  <div class="res-headline">Photo ${idx + 1} of ${v.photos.length} <span class="format-badge-chip">Carousel Item</span></div>
                  <div class="res-subline">Original Resolution • High Quality JPG</div>
                </div>
              </div>
              <button type="button" class="btn-res-action table-dl-btn" data-quality="1080" data-type="photo" data-photourl="${p.downloadUrl}" data-photoname="${p.filename || ('photo_' + (idx + 1) + '.jpg')}">
                <svg style="width:16px;height:16px;fill:currentColor" viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
                <span>Download Photo ${idx + 1}</span>
              </button>
            </div>
          `;
        });
      }

      col.innerHTML = html;
      const btnText = document.getElementById('downloadBtnText');
      if (btnText) btnText.textContent = '⚡ Save HD Photo to Phone Gallery';
    } else {
      selectedFormat = '1080';
      selectedType = 'video';
      col.innerHTML = `
        <div class="res-item-row selected" data-quality="1080" data-type="video">
          <div class="res-left">
            <span class="res-pill pill-1080">1080p</span>
            <div class="res-info">
              <div class="res-headline">1080p (Full HD) <span class="format-badge-chip">MP4 Video</span></div>
              <div class="res-subline">Maximum Quality • 1920x1080 • Direct Playable</div>
            </div>
          </div>
          <button type="button" class="btn-res-action table-dl-btn" data-quality="1080" data-type="video">
            <svg style="width:16px;height:16px;fill:currentColor" viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
            <span>Download 1080p</span>
          </button>
        </div>

        <div class="res-item-row" data-quality="720" data-type="video">
          <div class="res-left">
            <span class="res-pill pill-720">720p</span>
            <div class="res-info">
              <div class="res-headline">720p (HD Standard) <span class="format-badge-chip">MP4 Video</span></div>
              <div class="res-subline">Standard HD • Recommended for Mobile</div>
            </div>
          </div>
          <button type="button" class="btn-res-action table-dl-btn" data-quality="720" data-type="video">
            <svg style="width:16px;height:16px;fill:currentColor" viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
            <span>Download 720p</span>
          </button>
        </div>

        <div class="res-item-row" data-quality="480" data-type="video">
          <div class="res-left">
            <span class="res-pill" style="background:#e0e7ff;color:#3730a3;font-weight:700;">480p</span>
            <div class="res-info">
              <div class="res-headline">480p (Standard) <span class="format-badge-chip">MP4 Video</span></div>
              <div class="res-subline">Fast Download • High Compatibility</div>
            </div>
          </div>
          <button type="button" class="btn-res-action table-dl-btn" data-quality="480" data-type="video">
            <svg style="width:16px;height:16px;fill:currentColor" viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
            <span>Download 480p</span>
          </button>
        </div>

        <div class="res-item-row" data-quality="360" data-type="video">
          <div class="res-left">
            <span class="res-pill pill-360">360p</span>
            <div class="res-info">
              <div class="res-headline">360p (Fast / Data Saver) <span class="format-badge-chip">MP4 Video</span></div>
              <div class="res-subline">Fastest Download • Compact File Size</div>
            </div>
          </div>
          <button type="button" class="btn-res-action table-dl-btn" data-quality="360" data-type="video">
            <svg style="width:16px;height:16px;fill:currentColor" viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
            <span>Download 360p</span>
          </button>
        </div>

        <div class="res-item-row audio-row" data-quality="320" data-type="audio">
          <div class="res-left">
            <span class="res-pill pill-mp3">MP3</span>
            <div class="res-info">
              <div class="res-headline">MP3 Audio (High Quality 320kbps) <span class="format-badge-chip audio">Audio HQ</span></div>
              <div class="res-subline">Studio Sound • Music / Phone Ringtone</div>
            </div>
          </div>
          <button type="button" class="btn-res-action audio-btn table-dl-btn" data-quality="320" data-type="audio">
            <svg style="width:16px;height:16px;fill:currentColor" viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
            <span>Download MP3</span>
          </button>
        </div>
      `;
      const btnText = document.getElementById('downloadBtnText');
      if (btnText) btnText.textContent = '⚡ Save 1080p Video to Phone Gallery';
    }

    initResolutionRowListeners();
  }

  // Quality Table direct download buttons setup
  initResolutionRowListeners();

  // Main Download Button
  if (downloadBtn) {
    downloadBtn.addEventListener('click', () => {
      const isPhoto = currentVideoData && (currentVideoData.isPhoto || currentVideoData.type === 'photo');
      const qualityNum = selectedFormat.replace(/[^0-9]/g, '') || (isPhoto ? '1080' : '1080');
      const dlType = isPhoto ? 'photo' : (selectedType || 'video');
      downloadSpecificQuality(qualityNum, dlType, downloadBtn);
    });
  }

  // Helper to reset milestones
  function resetTurboMilestones() {
    if (step1Dot) { step1Dot.className = 'milestone-step active'; }
    if (step1Line) { step1Line.className = 'milestone-line'; }
    if (step2Dot) { step2Dot.className = 'milestone-step'; }
    if (step2Line) { step2Line.className = 'milestone-line'; }
    if (step3Dot) { step3Dot.className = 'milestone-step'; }
  }

  // 1-Click Fast Direct Download (No Boring Experience, Instant Gallery Save)
  async function fastOneClickDownload(url, quality = '1080', type = 'video', triggerBtn = null) {
    if (!url) return;

    // Ensure result metadata is populated or initiated
    if (!currentVideoData || currentVideoData.url !== url) {
      fetchVideoMetadata(url);
    }

    const customPhotoUrl = triggerBtn ? triggerBtn.getAttribute('data-photourl') : null;
    const customPhotoName = triggerBtn ? triggerBtn.getAttribute('data-photoname') : null;
    const isPhoto = (currentVideoData && (currentVideoData.isPhoto || currentVideoData.type === 'photo')) || type === 'photo' || !!customPhotoUrl;
    const effectiveType = isPhoto ? 'photo' : type;

    const originalBtnHtml = triggerBtn ? triggerBtn.innerHTML : '';
    if (triggerBtn) {
      triggerBtn.disabled = true;
      triggerBtn.innerHTML = `<span>⚡ Fast DL Starting...</span>`;
    }

    // Show Turbo HUD immediately
    progressBox.style.display = 'block';
    successCard.style.display = 'none';
    resetTurboMilestones();

    progressBarFill.style.width = '25%';
    progressPercent.textContent = '25%';
    if (progressSpeed) progressSpeed.textContent = '16.4 MB/s';
    if (progressEta) progressEta.textContent = '⏱ ETA: ~1.2s';
    if (turboStatusStep) turboStatusStep.textContent = '⚡ Connecting to High-Speed CDN Edge Node...';
    if (progressBytes) progressBytes.textContent = isPhoto ? 'Preparing Full HD Photo...' : `Multiplexing ${quality}${type === 'audio' ? 'kbps' : 'p'} stream...`;

    // Step 1 done, move to Step 2
    setTimeout(() => {
      if (step1Dot) step1Dot.classList.add('completed');
      if (step1Line) step1Line.classList.add('completed');
      if (step2Dot) step2Dot.classList.add('active');
      progressBarFill.style.width = '65%';
      progressPercent.textContent = '65%';
      if (progressSpeed) progressSpeed.textContent = '19.8 MB/s';
      if (progressEta) progressEta.textContent = '⏱ ETA: ~0.5s';
      if (turboStatusStep) turboStatusStep.textContent = isPhoto ? '📸 Downloading Original Resolution Image...' : '🚀 Extracting High-Definition Stream with Audio...';
    }, 400);

    // Fast-path: If user clicked a direct carousel photo item
    if (customPhotoUrl) {
      setTimeout(() => {
        if (step2Dot) step2Dot.classList.add('completed');
        if (step2Line) step2Line.classList.add('completed');
        if (step3Dot) step3Dot.classList.add('active', 'completed');
        progressBarFill.style.width = '100%';
        progressPercent.textContent = '100%';
        if (progressSpeed) progressSpeed.textContent = '22.4 MB/s';
        if (progressEta) progressEta.textContent = '✓ Ready!';
        if (turboStatusStep) turboStatusStep.textContent = '💾 Saving directly to Device Gallery & Downloads!';

        const filename = customPhotoName || 'instagram_photo_HD.jpg';
        const finalDownloadUrl = `/api/proxy?url=${encodeURIComponent(customPhotoUrl)}&filename=${encodeURIComponent(filename)}&type=photo`;
        triggerBrowserDownload(finalDownloadUrl, filename);
        showSuccessCard(filename, finalDownloadUrl, 'photo');
        if (triggerBtn) triggerBtn.innerHTML = `<span>✓ Fast Download Started!</span>`;
      }, 500);

      setTimeout(() => {
        if (triggerBtn) {
          triggerBtn.disabled = false;
          triggerBtn.innerHTML = originalBtnHtml;
        }
        progressBox.style.display = 'none';
      }, 2500);
      return;
    }

    try {
      const resolveUrl = `/api/resolve?url=${encodeURIComponent(url)}&quality=${quality}&type=${effectiveType}`;
      const response = await fetch(resolveUrl);
      const data = await response.json();

      // Step 2 done, move to Step 3
      if (step2Dot) step2Dot.classList.add('completed');
      if (step2Line) step2Line.classList.add('completed');
      if (step3Dot) step3Dot.classList.add('active', 'completed');
      progressBarFill.style.width = '100%';
      progressPercent.textContent = '100%';
      if (progressSpeed) progressSpeed.textContent = '22.4 MB/s';
      if (progressEta) progressEta.textContent = '✓ Ready!';
      if (turboStatusStep) turboStatusStep.textContent = '💾 Saving directly to Device Gallery & Downloads!';

      if (data && data.success && data.downloadUrl) {
        const isResultPhoto = data.isPhoto || data.type === 'photo' || effectiveType === 'photo';
        const ext = effectiveType === 'audio' ? 'mp3' : (isResultPhoto ? 'jpg' : 'mp4');
        const filename = data.filename || `media_${quality}p.${ext}`;
        const finalDownloadUrl = data.streamProxyUrl || `/api/proxy?url=${encodeURIComponent(data.downloadUrl)}&filename=${encodeURIComponent(filename)}&type=${effectiveType}`;

        if (currentVideoData) {
          currentVideoData.resolvedUrl = data.downloadUrl;
          currentVideoData.resolvedFilename = filename;
        }

        triggerBrowserDownload(finalDownloadUrl, filename);
        showSuccessCard(filename, finalDownloadUrl, effectiveType);
        if (triggerBtn) triggerBtn.innerHTML = `<span>✓ Fast Download Started!</span>`;
      } else {
        const errMsg = (data && data.error) ? data.error : 'Could not extract direct media stream. Please verify the link is public.';
        alert(errMsg);
        if (triggerBtn) triggerBtn.innerHTML = `<span>Download Failed</span>`;
      }
    } catch (err) {
      console.warn('Fast DL error:', err);
      alert('Unable to extract direct stream for this link right now. Please check if the link is public and accessible.');
      if (triggerBtn) triggerBtn.innerHTML = `<span>Download Failed</span>`;
    } finally {
      setTimeout(() => {
        if (triggerBtn) {
          triggerBtn.disabled = false;
          triggerBtn.innerHTML = originalBtnHtml;
        }
        progressBox.style.display = 'none';
      }, 2500);
    }
  }

  // Core Download Handler: Specific quality clicked
  async function downloadSpecificQuality(quality, type, triggerBtn) {
    const url = (currentVideoData && currentVideoData.url) || urlInput.value.trim();
    if (!url) return;
    await fastOneClickDownload(url, quality, type, triggerBtn);
  }

  // Trigger Native Phone Browser File Download directly into device Gallery & Downloads
  function triggerBrowserDownload(fileUrl, filename) {
    const link = document.createElement('a');
    link.href = fileUrl;
    link.setAttribute('download', filename);
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();

    setTimeout(() => {
      if (document.body.contains(link)) {
        document.body.removeChild(link);
      }
    }, 1500);
  }

  // Display Success Card with direct file link
  function showSuccessCard(filename, downloadUrl, type) {
    if (directSaveFileBtn && downloadUrl) {
      directSaveFileBtn.style.display = 'flex';
      directSaveFileBtn.href = downloadUrl;
      directSaveFileBtn.setAttribute('download', filename);
      if (directSaveText) {
        const typeLabel = type === 'audio' ? 'MP3 Audio' : (type === 'photo' ? 'HD Photo' : 'MP4 Video');
        directSaveText.textContent = `Save ${typeLabel} File`;
      }
    }
    successCard.style.display = 'block';
    successCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // Play Video / Preview Modal (100% Real Video - Never test color bars)
  function openVideoModal() {
    modalVideoTitle.textContent = currentVideoData ? currentVideoData.title : 'Video Playback';

    if (currentVideoData && currentVideoData.ytInfo && currentVideoData.ytInfo.id) {
      // Embed official YouTube stream - 100% exact video, full duration & sound
      modalYoutubeIframe.src = `https://www.youtube.com/embed/${currentVideoData.ytInfo.id}?autoplay=1&playsinline=1`;
      modalYoutubeIframe.style.display = 'block';
      modalVideoElement.style.display = 'none';
      modalDurationBadge.textContent = `⏱ Duration: ${currentVideoData.duration || 'Full'}`;
    } else if (currentVideoData && currentVideoData.resolvedUrl) {
      // Direct MP4 stream playback
      modalVideoElement.src = currentVideoData.resolvedUrl;
      modalVideoElement.style.display = 'block';
      modalYoutubeIframe.style.display = 'none';
      modalVideoElement.load();
      modalVideoElement.play().catch(() => {});
      modalDurationBadge.textContent = `⏱ Duration: ${currentVideoData.duration || 'HD Stream'}`;
    } else {
      modalYoutubeIframe.style.display = 'none';
      modalVideoElement.style.display = 'none';
    }

    videoPlayerModal.style.display = 'flex';
  }

  function closeVideoModal() {
    if (modalYoutubeIframe) {
      modalYoutubeIframe.src = '';
    }
    if (modalVideoElement) {
      modalVideoElement.pause();
      modalVideoElement.currentTime = 0;
      modalVideoElement.src = '';
    }
    videoPlayerModal.style.display = 'none';
  }

  if (openVideoBtn) {
    openVideoBtn.addEventListener('click', openVideoModal);
  }

  if (headerWatchBtn) {
    headerWatchBtn.addEventListener('click', openVideoModal);
  }

  if (closeModalBtn) {
    closeModalBtn.addEventListener('click', closeVideoModal);
  }

  if (modalCloseActionBtn) {
    modalCloseActionBtn.addEventListener('click', closeVideoModal);
  }

  if (modalBackdrop) {
    modalBackdrop.addEventListener('click', closeVideoModal);
  }

  if (modalSaveBtn) {
    modalSaveBtn.addEventListener('click', () => {
      closeVideoModal();
      downloadBtn.click();
    });
  }

  // Share Button
  if (shareVideoBtn) {
    shareVideoBtn.addEventListener('click', async () => {
      if (navigator.share && currentVideoData) {
        try {
          await navigator.share({
            title: currentVideoData.title,
            text: `Download video with YT Download: ${currentVideoData.title}`,
            url: window.location.href
          });
        } catch (err) {
          console.log('Share canceled');
        }
      } else {
        navigator.clipboard.writeText(window.location.href);
        alert('Link copied to clipboard! Share it with your friends.');
      }
    });
  }

  // Download Another
  if (downloadAgainBtn) {
    downloadAgainBtn.addEventListener('click', () => {
      urlInput.value = '';
      resultCard.style.display = 'none';
      successCard.style.display = 'none';
      urlInput.focus();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // Legal & Info Modals (Terms, Privacy Policy, Contact Us)
  const infoModal = document.getElementById('infoModal');
  const infoModalBackdrop = document.getElementById('infoModalBackdrop');
  const infoModalTitle = document.getElementById('infoModalTitle');
  const infoModalBody = document.getElementById('infoModalBody');
  const closeInfoModalBtn = document.getElementById('closeInfoModalBtn');
  const infoModalCloseActionBtn = document.getElementById('infoModalCloseActionBtn');
  const termsConditionsLink = document.getElementById('termsConditionsLink');
  const privacyPolicyLink = document.getElementById('privacyPolicyLink');
  const contactUsLink = document.getElementById('contactUsLink');

  const legalContent = {
    terms: {
      title: 'Terms & Conditions',
      html: `
        <div style="display:flex;flex-direction:column;gap:18px;">
          <p style="color:var(--text-muted);font-size:0.85rem;">Last Updated: September 2026</p>
          
          <div style="background:#f8fafc;border-left:4px solid var(--primary-color);padding:14px 16px;border-radius:4px;">
            <h4 style="font-size:1.05rem;margin-bottom:6px;color:var(--text-main);">1. Platform Disclaimer</h4>
            <p style="color:#334155;line-height:1.6;">"This website is an independent utility and is not affiliated with, sponsored by, or endorsed by YouTube, TikTok, Instagram, Facebook, or any of their parent companies."</p>
          </div>

          <div style="background:#f8fafc;border-left:4px solid var(--accent-cyan);padding:14px 16px;border-radius:4px;">
            <h4 style="font-size:1.05rem;margin-bottom:6px;color:var(--text-main);">2. User Responsibility & Fair Use</h4>
            <p style="color:#334155;line-height:1.6;">"By using this tool, you represent and warrant that you own the rights to the content or have secured explicit permission from the original owner before downloading. You agree not to download copyrighted material without proper authorization."</p>
          </div>

          <div style="background:#f8fafc;border-left:4px solid var(--tiktok-pink);padding:14px 16px;border-radius:4px;">
            <h4 style="font-size:1.05rem;margin-bottom:6px;color:var(--text-main);">3. Limitation of Liability</h4>
            <p style="color:#334155;line-height:1.6;">"This service is provided 'as is' without warranties of any kind. We accept no liability or responsibility for how downloaded files are stored, shared, or utilized by the end user."</p>
          </div>

          <div>
            <h4 style="font-size:1rem;margin-bottom:6px;color:var(--text-main);">4. Acceptable Use</h4>
            <p style="color:var(--text-muted);line-height:1.6;">You agree to use this platform only for lawful personal purposes and in strict compliance with applicable intellectual property and copyright regulations.</p>
          </div>

          <div style="margin-top:8px;padding-top:14px;border-top:1px solid var(--border-color);font-size:0.85rem;color:var(--text-muted);">
            Questions about these terms? Reach out to us at <a href="mailto:xinghsuraj733@gmail.com" style="color:var(--primary-color);font-weight:600;">xinghsuraj733@gmail.com</a>.
          </div>
        </div>
      `
    },
    privacy: {
      title: 'Privacy Policy',
      html: `
        <div style="display:flex;flex-direction:column;gap:18px;">
          <p style="color:var(--text-muted);font-size:0.85rem;">Last Updated: September 2026</p>

          <div>
            <h4 style="font-size:1.05rem;margin-bottom:6px;color:var(--text-main);">1. Overview & Commitment</h4>
            <p style="color:#334155;line-height:1.6;">Your privacy is paramount to us. YT Download operates as a client-first media utility designed to minimize data collection and preserve user anonymity.</p>
          </div>

          <div style="background:#f8fafc;border-left:4px solid var(--accent-green);padding:14px 16px;border-radius:4px;">
            <h4 style="font-size:1.05rem;margin-bottom:6px;color:var(--text-main);">2. Information We Do NOT Collect</h4>
            <ul style="padding-left:20px;color:#334155;line-height:1.7;">
              <li>We do <strong>not</strong> require account registration, usernames, or passwords.</li>
              <li>We do <strong>not</strong> store or archive downloaded video files on our servers. All video and audio streams are processed directly in transit to your device.</li>
              <li>We do <strong>not</strong> track, sell, or monetize your search history or personal information.</li>
            </ul>
          </div>

          <div>
            <h4 style="font-size:1.05rem;margin-bottom:6px;color:var(--text-main);">3. Logs & Technical Metrics</h4>
            <p style="color:#334155;line-height:1.6;">Temporary diagnostic headers (e.g. rate-limiting, error reporting, and load balancing) may be processed in server volatile memory to maintain service health, prevent abuse, and deliver fast response times. These temporary logs are automatically flushed.</p>
          </div>

          <div>
            <h4 style="font-size:1.05rem;margin-bottom:6px;color:var(--text-main);">4. Cookies & Local Storage</h4>
            <p style="color:#334155;line-height:1.6;">We do not use tracking or advertising cookies. Any local state stored in your browser (e.g., UI preferences) remains exclusively on your own device.</p>
          </div>

          <div>
            <h4 style="font-size:1.05rem;margin-bottom:6px;color:var(--text-main);">5. Third-Party Links & Services</h4>
            <p style="color:#334155;line-height:1.6;">Our service processes publicly available video URLs from third-party hosting platforms (such as YouTube, TikTok, and Instagram). These third parties maintain independent privacy policies that govern their respective services.</p>
          </div>

          <div style="margin-top:8px;padding-top:14px;border-top:1px solid var(--border-color);font-size:0.85rem;color:var(--text-muted);">
            For privacy inquiries or data requests, contact our privacy contact at <a href="mailto:xinghsuraj733@gmail.com" style="color:var(--primary-color);font-weight:600;">xinghsuraj733@gmail.com</a>.
          </div>
        </div>
      `
    },
    contact: {
      title: 'Contact Us',
      html: `
        <div style="display:flex;flex-direction:column;gap:18px;">
          <p style="color:#334155;line-height:1.6;">Have feedback, bug reports, feature requests, or copyright inquiries? We are here to help!</p>

          <div style="background:#f8fafc;border:1px solid var(--border-color);border-radius:10px;padding:18px;">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
              <div style="width:40px;height:40px;border-radius:50%;background:#fee2e2;display:flex;align-items:center;justify-content:center;color:var(--primary-color);">
                <svg style="width:20px;height:20px;fill:currentColor;" viewBox="0 0 24 24"><path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>
              </div>
              <div>
                <div style="font-size:0.85rem;color:var(--text-muted);font-weight:600;">Official Support Email</div>
                <a href="mailto:xinghsuraj733@gmail.com" style="font-size:1.1rem;font-weight:700;color:var(--primary-color);text-decoration:none;">xinghsuraj733@gmail.com</a>
              </div>
            </div>
            <p style="font-size:0.88rem;color:var(--text-muted);margin:0;">Feel free to email us directly for swift response regarding service performance, platform compatibility, or legal correspondence.</p>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
            <div style="background:#ffffff;border:1px solid var(--border-color);padding:14px;border-radius:8px;">
              <h5 style="margin-bottom:4px;color:var(--text-main);font-size:0.95rem;">⚡ Response Time</h5>
              <p style="font-size:0.85rem;color:var(--text-muted);margin:0;">Inquiries typically receive a reply within 24–48 hours.</p>
            </div>
            <div style="background:#ffffff;border:1px solid var(--border-color);padding:14px;border-radius:8px;">
              <h5 style="margin-bottom:4px;color:var(--text-main);font-size:0.95rem;">🛡️ DMCA & Copyright</h5>
              <p style="font-size:0.85rem;color:var(--text-muted);margin:0;">Include relevant details in your email to ensure immediate handling.</p>
            </div>
          </div>
        </div>
      `
    }
  };

  function openInfoModal(type) {
    const item = legalContent[type];
    if (!item) return;
    infoModalTitle.textContent = item.title;
    infoModalBody.innerHTML = item.html;
    infoModal.style.display = 'flex';
  }

  function closeInfoModal() {
    infoModal.style.display = 'none';
  }

  if (termsConditionsLink) {
    termsConditionsLink.addEventListener('click', (e) => {
      e.preventDefault();
      openInfoModal('terms');
    });
  }

  if (privacyPolicyLink) {
    privacyPolicyLink.addEventListener('click', (e) => {
      e.preventDefault();
      openInfoModal('privacy');
    });
  }

  if (contactUsLink) {
    contactUsLink.addEventListener('click', (e) => {
      e.preventDefault();
      openInfoModal('contact');
    });
  }

  if (closeInfoModalBtn) {
    closeInfoModalBtn.addEventListener('click', closeInfoModal);
  }

  if (infoModalCloseActionBtn) {
    infoModalCloseActionBtn.addEventListener('click', closeInfoModal);
  }

  if (infoModalBackdrop) {
    infoModalBackdrop.addEventListener('click', closeInfoModal);
  }

  // APK Download Modal Controls
  const apkDownloadModal = document.getElementById('apkDownloadModal');
  const apkModalBackdrop = document.getElementById('apkModalBackdrop');
  const closeApkModalBtn = document.getElementById('closeApkModalBtn');
  const headerDownloadApkBtn = document.getElementById('headerDownloadApkBtn');
  const footerDownloadApkBtn = document.getElementById('footerDownloadApkBtn');
  const directDownloadApkLink = document.getElementById('directDownloadApkLink');

  function openApkModal() {
    if (apkDownloadModal) {
      apkDownloadModal.style.display = 'flex';
    }
  }

  function closeApkModal() {
    if (apkDownloadModal) {
      apkDownloadModal.style.display = 'none';
    }
  }

  // APK Direct Download Function
  function triggerApkDownload(apkUrl = '/download-apk') {
    // Direct top-window location change ensures Android native package download starts cleanly
    window.location.href = apkUrl;

    // Toast notification
    let toast = document.getElementById('apkToastNotice');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'apkToastNotice';
      toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#0f172a;color:#ffffff;padding:12px 24px;border-radius:12px;font-size:0.9rem;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,0.3);z-index:99999;transition:opacity 0.2s;border:1px solid rgba(255,255,255,0.15);';
      document.body.appendChild(toast);
    }
    toast.textContent = '⬇️ Downloading YT_Download.apk (18 MB)... Once downloaded, open it from your phone notification or Downloads folder to install!';
    toast.style.display = 'block';
    toast.style.opacity = '1';
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => { toast.style.display = 'none'; }, 300);
    }, 5500);
  }

  if (headerDownloadApkBtn) {
    headerDownloadApkBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openApkModal();
    });
  }

  const topBannerDownloadApkBtn = document.getElementById('topBannerDownloadApkBtn');
  if (topBannerDownloadApkBtn) {
    topBannerDownloadApkBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openApkModal();
    });
  }

  if (footerDownloadApkBtn) {
    footerDownloadApkBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openApkModal();
    });
  }

  const directDownloadApkLinkTop = document.getElementById('directDownloadApkLinkTop');
  if (directDownloadApkLinkTop) {
    directDownloadApkLinkTop.addEventListener('click', (e) => {
      e.preventDefault();
      triggerApkDownload('/download-apk');
    });
  }

  if (directDownloadApkLink) {
    directDownloadApkLink.addEventListener('click', (e) => {
      e.preventDefault();
      triggerApkDownload('/download-apk');
    });
  }

  if (closeApkModalBtn) {
    closeApkModalBtn.addEventListener('click', closeApkModal);
  }

  if (apkModalBackdrop) {
    apkModalBackdrop.addEventListener('click', closeApkModal);
  }

  // Support URL hash navigation (#terms, #privacy, #contact, #apk-download)
  function checkHashNavigation() {
    const hash = window.location.hash.replace('#', '').toLowerCase();
    if (hash === 'terms') openInfoModal('terms');
    else if (hash === 'privacy') openInfoModal('privacy');
    else if (hash === 'contact') openInfoModal('contact');
    else if (hash === 'apk-download' || hash === 'download-apk' || hash === 'apk') openApkModal();
  }

  window.addEventListener('hashchange', checkHashNavigation);
  checkHashNavigation();
});
