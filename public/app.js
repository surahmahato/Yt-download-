// YT Download - Lightweight Video Downloader & Interactive 3D Website Model Engine
document.addEventListener('DOMContentLoaded', () => {
  const urlInput = document.getElementById('videoUrlInput');
  const pasteBtn = document.getElementById('pasteBtn');
  const fetchBtn = document.getElementById('fetchBtn');
  const filterTabs = document.querySelectorAll('.filter-tab');
  const resultCard = document.getElementById('videoResultCard');
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

  const videoThumb = document.getElementById('videoThumb');
  const videoDuration = document.getElementById('videoDuration');
  const videoTitle = document.getElementById('videoTitle');
  const videoChannel = document.getElementById('videoChannel');
  const videoPlatformBadge = document.getElementById('videoPlatformBadge');
  const videoViews = document.getElementById('videoViews');

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

  function isRemovedPlatformUrl(rawUrl) {
    const lower = (rawUrl || '').toLowerCase();
    return (
      lower.includes('instagram.com') ||
      lower.includes('instagr.am') ||
      lower.includes('facebook.com') ||
      lower.includes('fb.watch') ||
      lower.includes('fb.gg')
    );
  }

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
        urlInput.placeholder = 'Paste TikTok video or audio link (no watermark)...';
        break;
      default:
        urlInput.placeholder = 'Paste YouTube, Shorts, TikTok, or direct MP4 video link...';
    }
  }

  const FUN_TIPS = [
    'Saved videos go directly into your phone\'s <strong>Gallery &gt; Downloads</strong> album!',
    'Multi-threaded CDN stream delivers up to <strong>18.5 MB/s</strong> direct throughput.',
    'Want to watch right away? Tap <strong>▶ Play Preview</strong> above to watch without waiting!',
    'Need only the song or audio? Tap <strong>Instant MP3</strong> for crystal-clear 320kbps audio.',
    'YouTube Shorts &amp; TikTok clips are saved in original HD resolution with zero watermarks.'
  ];
  let tipIndex = 0;
  setInterval(() => {
    if (rotatingTipText) {
      tipIndex = (tipIndex + 1) % FUN_TIPS.length;
      rotatingTipText.innerHTML = FUN_TIPS[tipIndex];
    }
  }, 3500);

  let prefetchTimer = null;
  if (urlInput) {
    urlInput.addEventListener('input', () => {
      const rawVal = urlInput.value.trim();
      detectPlatformFromUrl(rawVal);
      if (rawVal.startsWith('http') && !isRemovedPlatformUrl(rawVal) && (rawVal.includes('youtu') || rawVal.includes('tiktok'))) {
        clearTimeout(prefetchTimer);
        prefetchTimer = setTimeout(() => {
          fetch(`/api/resolve?url=${encodeURIComponent(rawVal)}&quality=720&type=video`).catch(() => {});
        }, 400);
      }
    });
  }

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
        urlInput.focus();
        return;
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
        urlInput.focus();
        return;
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

  if (whileWaitPlayBtn) {
    whileWaitPlayBtn.addEventListener('click', openVideoModal);
  }

  function detectPlatformFromUrl(url) {
    const lower = (url || '').toLowerCase();
    if (lower.includes('youtube.com') || lower.includes('youtu.be')) {
      setActivePlatformTab('youtube');
    } else if (lower.includes('tiktok.com')) {
      setActivePlatformTab('tiktok');
    } else {
      setActivePlatformTab('all');
    }
  }

  function setActivePlatformTab(platform) {
    filterTabs.forEach(tab => {
      tab.classList.toggle('active', tab.getAttribute('data-platform') === platform);
    });
    currentPlatform = platform;
  }

  if (fetchBtn) {
    fetchBtn.addEventListener('click', () => {
      const url = urlInput.value.trim();
      if (!url) {
        alert('Please paste a YouTube, Shorts, TikTok, or direct video link.');
        urlInput.focus();
        return;
      }
      if (isRemovedPlatformUrl(url)) {
        alert('Instagram and Facebook video downloading have been removed. Please paste a YouTube, Shorts, TikTok, or direct video link.');
        return;
      }
      fetchVideoMetadata(url);
    });
  }

  if (urlInput) {
    urlInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        fetchBtn.click();
      }
    });
  }

  function extractYouTubeId(url) {
    const shortsMatch = url.match(/\/shorts\/([a-zA-Z0-9_-]{11})/i);
    if (shortsMatch && shortsMatch[1]) return { id: shortsMatch[1], isShort: true };

    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
    const match = url.match(regex);
    if (match && match[1]) return { id: match[1], isShort: false };

    return null;
  }

  async function fetchVideoMetadata(url) {
    if (isRemovedPlatformUrl(url)) {
      alert('Instagram and Facebook video downloading have been removed. Please paste a YouTube, Shorts, TikTok, or direct video link.');
      return;
    }

    fetchBtn.disabled = true;
    fetchBtn.innerHTML = '<span>Analyzing link...</span>';

    let platformName = 'YouTube';
    let thumbUrl = 'https://images.unsplash.com/photo-1536240478700-b869070f9279?w=600&auto=format&fit=crop&q=80';
    let title = 'HD Playable Video';
    let channel = 'Creator';
    let duration = '01:23';
    let views = 'High Definition';
    let ytInfo = extractYouTubeId(url);

    const lower = url.toLowerCase();
    if (lower.includes('tiktok.com')) {
      platformName = 'TikTok';
      title = 'TikTok Video (No Watermark)';
      channel = '@tiktok_creator';
    } else if (ytInfo) {
      platformName = ytInfo.isShort ? 'YouTube Shorts' : 'YouTube';
      thumbUrl = `https://i.ytimg.com/vi/${ytInfo.id}/hqdefault.jpg`;
      title = ytInfo.isShort ? 'YouTube Shorts Video' : 'YouTube Video';
    } else {
      platformName = 'Video Stream';
      title = 'Playable Media Stream';
      channel = 'Online Video';
    }

    try {
      const analyzeRes = await fetch(`/api/analyze?url=${encodeURIComponent(url)}`);
      const analyzeData = await analyzeRes.json();
      if (!analyzeRes.ok || !analyzeData.success) {
        if (analyzeData && analyzeData.error) {
          alert(analyzeData.error);
          fetchBtn.disabled = false;
          fetchBtn.innerHTML = '<span>⚡ Fast Download</span>';
          return;
        }
      } else {
        const v = analyzeData.video || analyzeData;
        if (v.title) title = v.title;
        if (v.thumbnail) thumbUrl = v.thumbnail;
        if (v.durationLabel || v.duration) duration = v.durationLabel || v.duration;
        if (v.platform) platformName = v.platform;
        if (v.channel || v.author) channel = v.channel || v.author;
        if (v.id && ytInfo) ytInfo.id = v.id;
      }
    } catch (err) {
      console.warn('Backend analyze fallback:', err.message);
    }

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

    currentVideoData = {
      url,
      platform: platformName,
      thumbUrl,
      title,
      channel,
      duration,
      views,
      ytInfo,
      type: 'video'
    };

    renderResolutionOptions();

    videoThumb.src = thumbUrl;
    videoDuration.textContent = duration;
    videoTitle.textContent = title;
    videoChannel.textContent = channel;
    videoPlatformBadge.textContent = platformName;
    videoViews.textContent = views;

    const badgeClass = platformName.toLowerCase().includes('tiktok') ? 'tiktok' : 'youtube';
    videoPlatformBadge.className = `platform-pill ${badgeClass}`;

    resultCard.style.display = 'block';
    successCard.style.display = 'none';
    progressBox.style.display = 'none';

    fetchBtn.disabled = false;
    fetchBtn.innerHTML = '<span>⚡ Fast Download</span>';

    resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderResolutionOptions() {
    const col = document.getElementById('resolutionSingleColumn');
    if (!col) return;

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
    initResolutionRowListeners();
  }

  if (downloadBtn) {
    downloadBtn.addEventListener('click', () => {
      const qualityNum = selectedFormat.replace(/[^0-9]/g, '') || '1080';
      const dlType = selectedType || 'video';
      downloadSpecificQuality(qualityNum, dlType, downloadBtn);
    });
  }

  function resetTurboMilestones() {
    if (step1Dot) step1Dot.className = 'milestone-step active';
    if (step1Line) step1Line.className = 'milestone-line';
    if (step2Dot) step2Dot.className = 'milestone-step';
    if (step2Line) step2Line.className = 'milestone-line';
    if (step3Dot) step3Dot.className = 'milestone-step';
  }

  async function fastOneClickDownload(url, quality = '1080', type = 'video', triggerBtn = null) {
    if (!url) return;
    if (isRemovedPlatformUrl(url)) {
      alert('Instagram and Facebook video downloading have been removed. Please paste a YouTube, Shorts, TikTok, or direct video link.');
      return;
    }

    if (!currentVideoData || currentVideoData.url !== url) {
      fetchVideoMetadata(url);
    }

    const originalBtnHtml = triggerBtn ? triggerBtn.innerHTML : '';
    if (triggerBtn) {
      triggerBtn.disabled = true;
      triggerBtn.innerHTML = '<span>⚡ Fast DL Starting...</span>';
    }

    progressBox.style.display = 'block';
    successCard.style.display = 'none';
    resetTurboMilestones();

    progressBarFill.style.width = '25%';
    progressPercent.textContent = '25%';
    if (progressSpeed) progressSpeed.textContent = '16.4 MB/s';
    if (progressEta) progressEta.textContent = '⏱ ETA: ~1.2s';
    if (turboStatusStep) turboStatusStep.textContent = '⚡ Connecting to High-Speed CDN Edge Node...';
    if (progressBytes) progressBytes.textContent = `Multiplexing ${quality}${type === 'audio' ? 'kbps' : 'p'} stream...`;

    setTimeout(() => {
      if (step1Dot) step1Dot.classList.add('completed');
      if (step1Line) step1Line.classList.add('completed');
      if (step2Dot) step2Dot.classList.add('active');
      progressBarFill.style.width = '65%';
      progressPercent.textContent = '65%';
      if (progressSpeed) progressSpeed.textContent = '19.8 MB/s';
      if (progressEta) progressEta.textContent = '⏱ ETA: ~0.5s';
      if (turboStatusStep) turboStatusStep.textContent = '🚀 Extracting High-Definition Stream with Audio...';
    }, 400);

    try {
      const resolveUrl = `/api/resolve?url=${encodeURIComponent(url)}&quality=${quality}&type=${type}`;
      const response = await fetch(resolveUrl);
      const data = await response.json();

      if (step2Dot) step2Dot.classList.add('completed');
      if (step2Line) step2Line.classList.add('completed');
      if (step3Dot) step3Dot.classList.add('active', 'completed');
      progressBarFill.style.width = '100%';
      progressPercent.textContent = '100%';
      if (progressSpeed) progressSpeed.textContent = '22.4 MB/s';
      if (progressEta) progressEta.textContent = '✓ Ready!';
      if (turboStatusStep) turboStatusStep.textContent = '💾 Saving directly to Device Gallery & Downloads!';

      if (data && data.success && data.downloadUrl) {
        const ext = type === 'audio' ? 'mp3' : 'mp4';
        const filename = data.filename || `media_${quality}p.${ext}`;
        const finalDownloadUrl = data.streamProxyUrl || `/api/proxy?url=${encodeURIComponent(data.downloadUrl)}&filename=${encodeURIComponent(filename)}&type=${type}`;

        if (currentVideoData) {
          currentVideoData.resolvedUrl = data.downloadUrl;
          currentVideoData.resolvedFilename = filename;
        }

        showSuccessCard(filename, finalDownloadUrl, type);
        triggerBrowserDownload(finalDownloadUrl, filename);
        if (triggerBtn) triggerBtn.innerHTML = '<span>✓ Ready to Download!</span>';
      } else {
        const errMsg = (data && data.error) ? data.error : 'Could not extract direct media stream. Please verify the link is public.';
        alert(errMsg);
        if (triggerBtn) triggerBtn.innerHTML = '<span>Download Failed</span>';
      }
    } catch (err) {
      console.warn('Fast DL error:', err);
      alert('Unable to extract direct stream for this link right now.');
      if (triggerBtn) triggerBtn.innerHTML = '<span>Download Failed</span>';
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

  async function downloadSpecificQuality(quality, type, triggerBtn) {
    const url = (currentVideoData && currentVideoData.url) || urlInput.value.trim();
    if (!url) return;
    await fastOneClickDownload(url, quality, type, triggerBtn);
  }

  function triggerBrowserDownload(fileUrl, filename) {
    try {
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = fileUrl;
      document.body.appendChild(iframe);
      setTimeout(() => {
        if (document.body.contains(iframe)) document.body.removeChild(iframe);
      }, 30000);
    } catch (e) {}

    try {
      const link = document.createElement('a');
      link.href = fileUrl;
      link.setAttribute('download', filename);
      link.target = '_self';
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      setTimeout(() => {
        if (document.body.contains(link)) document.body.removeChild(link);
      }, 2000);
    } catch (e) {}

    const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    if (isMobile) {
      setTimeout(() => {
        try { window.location.assign(fileUrl); } catch (e) {}
      }, 350);
    }
  }

  function showSuccessCard(filename, downloadUrl, type) {
    if (directSaveFileBtn && downloadUrl) {
      directSaveFileBtn.style.display = 'flex';
      directSaveFileBtn.href = downloadUrl;
      directSaveFileBtn.setAttribute('download', filename);
      if (directSaveText) {
        const typeLabel = type === 'audio' ? 'MP3 Audio' : 'MP4 Video';
        directSaveText.textContent = `⬇️ Download ${typeLabel} Now`;
      }
    }
    successCard.style.display = 'block';
    successCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  if (directSaveFileBtn) {
    directSaveFileBtn.addEventListener('click', () => {
      if (directSaveText) {
        directSaveText.textContent = '✓ Downloading... Check Notifications';
      }
    });
  }

  function openVideoModal() {
    modalVideoTitle.textContent = currentVideoData ? currentVideoData.title : 'Video Playback';

    if (currentVideoData && currentVideoData.ytInfo && currentVideoData.ytInfo.id) {
      modalYoutubeIframe.src = `https://www.youtube.com/embed/${currentVideoData.ytInfo.id}?autoplay=1&playsinline=1`;
      modalYoutubeIframe.style.display = 'block';
      modalVideoElement.style.display = 'none';
      modalDurationBadge.textContent = `⏱ Duration: ${currentVideoData.duration || 'Full'}`;
    } else if (currentVideoData && currentVideoData.resolvedUrl) {
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
    if (modalYoutubeIframe) modalYoutubeIframe.src = '';
    if (modalVideoElement) {
      modalVideoElement.pause();
      modalVideoElement.currentTime = 0;
      modalVideoElement.src = '';
    }
    videoPlayerModal.style.display = 'none';
  }

  if (openVideoBtn) openVideoBtn.addEventListener('click', openVideoModal);
  if (headerWatchBtn) headerWatchBtn.addEventListener('click', openVideoModal);
  if (closeModalBtn) closeModalBtn.addEventListener('click', closeVideoModal);
  if (modalCloseActionBtn) modalCloseActionBtn.addEventListener('click', closeVideoModal);
  if (modalBackdrop) modalBackdrop.addEventListener('click', closeVideoModal);
  if (modalSaveBtn) {
    modalSaveBtn.addEventListener('click', () => {
      closeVideoModal();
      downloadBtn.click();
    });
  }

  if (shareVideoBtn) {
    shareVideoBtn.addEventListener('click', async () => {
      if (navigator.share && currentVideoData) {
        try {
          await navigator.share({
            title: currentVideoData.title,
            text: `Download video with YT Download: ${currentVideoData.title}`,
            url: window.location.href
          });
        } catch (err) {}
      } else {
        navigator.clipboard.writeText(window.location.href);
        alert('Link copied to clipboard!');
      }
    });
  }

  if (downloadAgainBtn) {
    downloadAgainBtn.addEventListener('click', () => {
      urlInput.value = '';
      resultCard.style.display = 'none';
      successCard.style.display = 'none';
      urlInput.focus();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // APK Download Modal Controls
  const apkDownloadModal = document.getElementById('apkDownloadModal');
  const apkModalBackdrop = document.getElementById('apkModalBackdrop');
  const closeApkModalBtn = document.getElementById('closeApkModalBtn');
  const headerDownloadApkBtn = document.getElementById('headerDownloadApkBtn');
  const footerDownloadApkBtn = document.getElementById('footerDownloadApkBtn');
  const directDownloadApkLink = document.getElementById('directDownloadApkLink');
  const directDownloadApkLinkTop = document.getElementById('directDownloadApkLinkTop');

  function openApkModal() {
    if (apkDownloadModal) apkDownloadModal.style.display = 'flex';
  }
  function closeApkModal() {
    if (apkDownloadModal) apkDownloadModal.style.display = 'none';
  }

  function triggerApkDownload(apkUrl = '/download-apk') {
    window.location.href = apkUrl;
  }

  if (headerDownloadApkBtn) {
    headerDownloadApkBtn.addEventListener('click', (e) => {
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
  if (closeApkModalBtn) closeApkModalBtn.addEventListener('click', closeApkModal);
  if (apkModalBackdrop) apkModalBackdrop.addEventListener('click', closeApkModal);

  // =========================================================================
  // INTERACTIVE 3D WEBSITE ARCHITECTURE MODEL ENGINE
  // =========================================================================
  const viewport3d = document.getElementById('scene3dViewport');
  const pivot3d = document.getElementById('model3dPivot');
  const readout3d = document.getElementById('scene3dReadout');
  const explodeBtn = document.getElementById('toggleExplode3dBtn');
  const autoOrbitBtn = document.getElementById('toggleAutoOrbitBtn');
  const simulateFlowBtn = document.getElementById('simulate3dFlowBtn');
  const canvas3d = document.getElementById('conduit3dCanvas');

  if (viewport3d && pivot3d) {
    let rotX = -24;
    let rotY = 32;
    let zoom = 1.0;
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let autoOrbit = true;
    let isExploded = false;

    function update3dTransform(smooth = false) {
      if (smooth) {
        pivot3d.classList.add('smooth-cam');
      } else {
        pivot3d.classList.remove('smooth-cam');
      }
      pivot3d.style.transform = `rotateX(${rotX.toFixed(1)}deg) rotateY(${rotY.toFixed(1)}deg) scale3d(${zoom.toFixed(2)}, ${zoom.toFixed(2)}, ${zoom.toFixed(2)})`;
      if (readout3d) {
        const normY = (((Math.round(rotY) % 360) + 540) % 360) - 180;
        readout3d.textContent = `Pitch: ${Math.round(rotX)}° | Yaw: ${normY}° | Zoom: ${zoom.toFixed(2)}x`;
      }
    }

    viewport3d.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.mini-fmt-chip')) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      autoOrbit = false;
      if (autoOrbitBtn) autoOrbitBtn.classList.remove('active');
      viewport3d.setPointerCapture(e.pointerId);
    });

    viewport3d.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      startX = e.clientX;
      startY = e.clientY;
      rotY += dx * 0.45;
      rotX = Math.max(-80, Math.min(25, rotX - dy * 0.35));
      update3dTransform(false);
    });

    const endDrag = () => { isDragging = false; };
    viewport3d.addEventListener('pointerup', endDrag);
    viewport3d.addEventListener('pointercancel', endDrag);

    viewport3d.addEventListener('wheel', (e) => {
      e.preventDefault();
      zoom = Math.max(0.68, Math.min(1.38, zoom - e.deltaY * 0.0008));
      update3dTransform(false);
    }, { passive: false });

    // Camera Presets
    document.querySelectorAll('.cam-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.cam-preset-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        rotX = parseFloat(btn.getAttribute('data-rx') || '-24');
        rotY = parseFloat(btn.getAttribute('data-ry') || '32');
        zoom = 1.0;
        autoOrbit = false;
        if (autoOrbitBtn) autoOrbitBtn.classList.remove('active');
        update3dTransform(true);
      });
    });

    // Explode Layers Toggle
    if (explodeBtn) {
      explodeBtn.addEventListener('click', () => {
        isExploded = !isExploded;
        pivot3d.classList.toggle('exploded', isExploded);
        explodeBtn.classList.toggle('active', isExploded);
        explodeBtn.textContent = isExploded ? 'Collapse Layers' : 'Explode Layers';
      });
    }

    // Auto-Orbit Toggle
    if (autoOrbitBtn) {
      autoOrbitBtn.addEventListener('click', () => {
        autoOrbit = !autoOrbit;
        autoOrbitBtn.classList.toggle('active', autoOrbit);
      });
    }

    // Clickable miniature format chips inside the 3D Browser layer
    document.querySelectorAll('.mini-fmt-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.mini-fmt-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        const fmt = chip.getAttribute('data-fmt') || '1080p MP4';
        const saved1 = document.getElementById('mini3dSavedFile1');
        if (saved1) {
          saved1.textContent = fmt.includes('MP3') ? '🎵 YT_Audio_320kbps.mp3' : `🎬 YT_Video_${fmt.split(' ')[0]}.mp4`;
        }
      });
    });

    // Layer Selection & Inspector Sync
    function select3dLayer(layerKey) {
      document.querySelectorAll('.layer-3d-deck').forEach(deck => {
        deck.classList.toggle('selected-layer', deck.getAttribute('data-layer') === layerKey);
      });
      document.querySelectorAll('.inspector-card').forEach(card => {
        card.classList.toggle('active', card.getAttribute('data-inspect') === layerKey);
      });
    }

    document.querySelectorAll('.layer-3d-deck').forEach(deck => {
      deck.addEventListener('click', () => {
        select3dLayer(deck.getAttribute('data-layer'));
      });
    });

    document.querySelectorAll('.inspector-card').forEach(card => {
      card.addEventListener('click', () => {
        const key = card.getAttribute('data-inspect');
        select3dLayer(key);
        if (!isExploded) {
          isExploded = true;
          pivot3d.classList.add('exploded');
          if (explodeBtn) {
            explodeBtn.classList.add('active');
            explodeBtn.textContent = 'Collapse Layers';
          }
        }
      });
    });

    // Simulate 3D Download Flow Pulse
    if (simulateFlowBtn) {
      simulateFlowBtn.addEventListener('click', () => {
        const hudFill = document.getElementById('mini3dHudFill');
        const hudPct = document.getElementById('mini3dHudPct');
        const hudStatus = document.getElementById('mini3dHudStatus');
        const phoneBadge = document.getElementById('mini3dPhoneBadge');

        if (!isExploded) {
          isExploded = true;
          pivot3d.classList.add('exploded');
          if (explodeBtn) {
            explodeBtn.classList.add('active');
            explodeBtn.textContent = 'Collapse Layers';
          }
        }

        pivot3d.classList.add('pulse-active');
        select3dLayer('browser');
        if (hudFill) hudFill.style.width = '20%';
        if (hudPct) hudPct.textContent = '20%';
        if (hudStatus) hudStatus.textContent = '1. Parsing URL Manifest...';
        if (phoneBadge) phoneBadge.textContent = '⏳ Receiving...';

        setTimeout(() => {
          select3dLayer('engine');
          if (hudFill) hudFill.style.width = '68%';
          if (hudPct) hudPct.textContent = '68%';
          if (hudStatus) hudStatus.textContent = '2. Piping Node.js CDN Stream...';
        }, 650);

        setTimeout(() => {
          select3dLayer('phone');
          if (hudFill) hudFill.style.width = '100%';
          if (hudPct) hudPct.textContent = '100%';
          if (hudStatus) hudStatus.textContent = '✓ Saved to Phone Gallery!';
          if (phoneBadge) phoneBadge.textContent = '✓ Saved Now';
          pivot3d.classList.remove('pulse-active');
        }, 1450);
      });
    }

    // Lightweight Canvas 3D Starfield & Data Stream Particles
    const ctx = canvas3d ? canvas3d.getContext('2d') : null;
    const particles = Array.from({ length: 34 }, () => ({
      x: Math.random(),
      y: Math.random(),
      speed: 0.002 + Math.random() * 0.004,
      r: 1.2 + Math.random() * 1.8,
      hue: Math.random() > 0.5 ? '#38bdf8' : '#ef4444'
    }));

    function resize3dCanvas() {
      if (!canvas3d || !viewport3d) return;
      canvas3d.width = viewport3d.clientWidth;
      canvas3d.height = viewport3d.clientHeight;
    }
    resize3dCanvas();
    window.addEventListener('resize', resize3dCanvas);

    function animate3dLoop() {
      if (autoOrbit && !isDragging) {
        rotY += 0.22;
        update3dTransform(false);
      }

      if (ctx && canvas3d.width > 0) {
        ctx.clearRect(0, 0, canvas3d.width, canvas3d.height);
        for (const p of particles) {
          p.y += p.speed;
          if (p.y > 1) p.y = 0;
          ctx.beginPath();
          ctx.fillStyle = p.hue;
          ctx.globalAlpha = 0.55;
          ctx.arc(p.x * canvas3d.width, p.y * canvas3d.height, p.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      requestAnimationFrame(animate3dLoop);
    }
    requestAnimationFrame(animate3dLoop);
  }
});
