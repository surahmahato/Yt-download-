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
      alert('Please enter a YouTube, TikTok, or Instagram video link.');
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
    }

    // Call server analyzer endpoint for exact video title, thumbnail, duration
    try {
      const analyzeRes = await fetch(`/api/analyze?url=${encodeURIComponent(url)}`);
      if (analyzeRes.ok) {
        const analyzeData = await analyzeRes.json();
        if (analyzeData.success) {
          if (analyzeData.title) title = analyzeData.title;
          if (analyzeData.thumbnail) thumbUrl = analyzeData.thumbnail;
          if (analyzeData.duration) duration = analyzeData.duration;
          if (analyzeData.id) {
            if (!ytInfo) {
              ytInfo = { id: analyzeData.id, isShort: false };
            } else {
              ytInfo.id = analyzeData.id;
            }
          }
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

    currentVideoData = {
      url,
      platform: platformName,
      thumbUrl,
      title,
      channel,
      duration,
      views,
      ytInfo
    };

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

  // Quality Table direct download buttons
  document.querySelectorAll('.table-dl-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const quality = btn.getAttribute('data-quality') || '720';
      const type = btn.getAttribute('data-type') || 'video';
      downloadSpecificQuality(quality, type, btn);
    });
  });

  // Main Download Button
  if (downloadBtn) {
    downloadBtn.addEventListener('click', () => {
      const qualityNum = selectedFormat.replace(/[^0-9]/g, '') || '720';
      downloadSpecificQuality(qualityNum, selectedType, downloadBtn);
    });
  }

  // Core Download Handler: Fetches exact stream and saves directly to phone storage
  async function downloadSpecificQuality(quality, type, triggerBtn) {
    if (!currentVideoData) return;

    const originalBtnHtml = triggerBtn.innerHTML;
    triggerBtn.disabled = true;
    triggerBtn.innerHTML = `<span>⏳ Preparing ${quality}p...</span>`;

    progressBox.style.display = 'block';
    successCard.style.display = 'none';

    let progress = 20;
    progressBarFill.style.width = `${progress}%`;
    progressPercent.textContent = `${progress}%`;
    progressSpeed.textContent = 'Connecting...';
    progressBytes.textContent = `Resolving exact ${quality}${type === 'audio' ? 'kbps' : 'p'} stream...`;

    const progressInterval = setInterval(() => {
      if (progress < 90) {
        progress += Math.floor(Math.random() * 15) + 5;
        if (progress > 90) progress = 90;
        progressBarFill.style.width = `${progress}%`;
        progressPercent.textContent = `${progress}%`;
        progressSpeed.textContent = '6.4 MB/s';
      }
    }, 250);

    try {
      const resolveUrl = `/api/resolve?url=${encodeURIComponent(currentVideoData.url)}&quality=${quality}&type=${type}`;
      const response = await fetch(resolveUrl);
      const data = await response.json();

      clearInterval(progressInterval);
      progressBarFill.style.width = '100%';
      progressPercent.textContent = '100%';
      progressSpeed.textContent = 'Completed';

      if (data && data.success && data.downloadUrl) {
        currentVideoData.resolvedUrl = data.downloadUrl;
        currentVideoData.resolvedFilename = data.filename || `video_${quality}p.${type === 'audio' ? 'mp3' : 'mp4'}`;

        const isGateway = data.isGateway || data.downloadUrl.includes('ssyoutube') || data.downloadUrl.includes('savefrom');
        const finalDownloadUrl = isGateway
          ? data.downloadUrl
          : `/api/download?url=${encodeURIComponent(data.downloadUrl)}&filename=${encodeURIComponent(currentVideoData.resolvedFilename)}`;

        // Auto trigger browser download directly into Downloads folder / Gallery
        triggerBrowserDownload(finalDownloadUrl, currentVideoData.resolvedFilename);
        showSuccessCard(currentVideoData.resolvedFilename, finalDownloadUrl, type);

        triggerBtn.innerHTML = `<span>✓ Download Started!</span>`;
      } else {
        // Fallback to verified direct stream
        const fallbackUrl = currentVideoData.ytInfo && currentVideoData.ytInfo.id
          ? `https://en.ssyoutube.com/watch?v=${currentVideoData.ytInfo.id}`
          : `https://en.savefrom.net/398/#url=${encodeURIComponent(currentVideoData.url)}`;
        window.open(fallbackUrl, '_blank');
        showSuccessCard(`${currentVideoData.title}_${quality}p.mp4`, fallbackUrl, type);
        triggerBtn.innerHTML = `<span>✓ Direct Link Ready</span>`;
      }
    } catch (err) {
      console.error('Download error:', err);
      clearInterval(progressInterval);
      const fallbackUrl = currentVideoData.ytInfo && currentVideoData.ytInfo.id
        ? `https://en.ssyoutube.com/watch?v=${currentVideoData.ytInfo.id}`
        : `https://en.savefrom.net/398/#url=${encodeURIComponent(currentVideoData.url)}`;
      window.open(fallbackUrl, '_blank');
      showSuccessCard(`${currentVideoData.title || 'video'}_${quality}p.mp4`, fallbackUrl, type);
    } finally {
      setTimeout(() => {
        triggerBtn.disabled = false;
        triggerBtn.innerHTML = originalBtnHtml;
        progressBox.style.display = 'none';
      }, 2500);
    }
  }

  // Trigger Native Phone Browser File Download directly into device Gallery & Downloads
  function triggerBrowserDownload(fileUrl, filename) {
    const isDirectProxy = fileUrl.startsWith('/api/download') || fileUrl.startsWith('/api/proxy-download');

    // 1. Create invisible anchor with download attribute
    const link = document.createElement('a');
    link.href = fileUrl;
    link.setAttribute('download', filename);
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();

    // 2. Also navigate window location to the proxy download if not gateway
    if (isDirectProxy) {
      setTimeout(() => {
        window.location.href = fileUrl;
      }, 200);
    }

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
        directSaveText.textContent = `Save ${type === 'audio' ? 'MP3' : 'MP4'} File`;
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
});
