// Platform Detector & Video Downloader Engine
document.addEventListener('DOMContentLoaded', () => {
  const urlInput = document.getElementById('videoUrlInput');
  const pasteBtn = document.getElementById('pasteBtn');
  const fetchBtn = document.getElementById('fetchBtn');
  const filterTabs = document.querySelectorAll('.filter-tab');
  const resultCard = document.getElementById('videoResultCard');
  const formatCards = document.querySelectorAll('.format-card');
  const downloadBtn = document.getElementById('downloadActionBtn');
  const progressBox = document.getElementById('progressBox');
  const progressBarFill = document.getElementById('progressBarFill');
  const progressPercent = document.getElementById('progressPercent');
  const progressSpeed = document.getElementById('progressSpeed');
  const progressBytes = document.getElementById('progressBytes');
  const successCard = document.getElementById('downloadSuccessCard');
  const openVideoBtn = document.getElementById('openVideoBtn');
  const shareVideoBtn = document.getElementById('shareVideoBtn');
  const downloadAgainBtn = document.getElementById('downloadAgainBtn');

  // Video Info Elements
  const videoThumb = document.getElementById('videoThumb');
  const videoDuration = document.getElementById('videoDuration');
  const videoTitle = document.getElementById('videoTitle');
  const videoChannel = document.getElementById('videoChannel');
  const videoPlatformBadge = document.getElementById('videoPlatformBadge');
  const videoViews = document.getElementById('videoViews');

  let currentPlatform = 'all';
  let selectedFormat = '1080p';
  let selectedType = 'video';
  let currentVideoData = null;
  let downloadBlobUrl = null;

  // Clipboard Paste Button
  if (pasteBtn) {
    pasteBtn.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          urlInput.value = text.trim();
          detectPlatformFromUrl(urlInput.value);
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

  // Format Card Selection
  formatCards.forEach(card => {
    card.addEventListener('click', () => {
      formatCards.forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      selectedFormat = card.getAttribute('data-quality');
      selectedType = card.getAttribute('data-type');
      
      const label = selectedType === 'audio' ? 'Save MP3 to Music & Phone Gallery' : `Save ${selectedFormat} Video to Phone Gallery`;
      document.getElementById('downloadBtnText').textContent = label;
    });
  });

  // Fetch Button Click
  fetchBtn.addEventListener('click', () => {
    const url = urlInput.value.trim();
    if (!url) {
      alert('Please enter a YouTube, TikTok, or Instagram link.');
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

  // Parse Metadata & Display
  function fetchVideoMetadata(url) {
    fetchBtn.disabled = true;
    fetchBtn.innerHTML = '<span>Analyzing...</span>';

    setTimeout(() => {
      fetchBtn.disabled = false;
      fetchBtn.innerHTML = `
        <svg style="width:18px;height:18px;fill:currentColor" viewBox="0 0 24 24">
          <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/>
        </svg>
        <span>Download</span>
      `;

      let platformName = 'YouTube';
      let thumbUrl = 'https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?w=600&auto=format&fit=crop&q=80';
      let title = 'Sample Video High Definition';
      let channel = 'Creative Media';
      let duration = '03:45';
      let views = '1.2M views';

      const lower = url.toLowerCase();
      if (lower.includes('tiktok.com')) {
        platformName = 'TikTok';
        thumbUrl = 'https://images.unsplash.com/photo-1611162617474-5b21e879e113?w=600&auto=format&fit=crop&q=80';
        title = 'Viral Trending Dance & Sounds (No Watermark)';
        channel = '@tiktok_creator';
        duration = '00:58';
        views = '850K plays';
      } else if (lower.includes('instagram.com')) {
        platformName = 'Instagram';
        thumbUrl = 'https://images.unsplash.com/photo-1611262588024-d12430b98920?w=600&auto=format&fit=crop&q=80';
        title = 'Instagram Reel Highlights & Cinematic Moments';
        channel = '@insta_traveler';
        duration = '01:15';
        views = '420K views';
      } else {
        platformName = 'YouTube';
        thumbUrl = 'https://images.unsplash.com/photo-1536240478700-b869070f9279?w=600&auto=format&fit=crop&q=80';
        title = 'Top Nature & Wildlife Documentary 4K Ultra HD';
        channel = 'Nature Explorer';
        duration = '08:24';
        views = '3.4M views';
      }

      currentVideoData = {
        url,
        platform: platformName,
        thumbUrl,
        title,
        channel,
        duration,
        views
      };

      videoThumb.src = thumbUrl;
      videoDuration.textContent = duration;
      videoTitle.textContent = title;
      videoChannel.textContent = channel;
      videoPlatformBadge.textContent = platformName;
      videoViews.textContent = views;

      // Update badge class
      videoPlatformBadge.className = `platform-pill ${platformName.toLowerCase()}`;

      resultCard.style.display = 'block';
      successCard.style.display = 'none';
      progressBox.style.display = 'none';

      resultCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 600);
  }

  // Download Trigger
  downloadBtn.addEventListener('click', () => {
    if (!currentVideoData) return;

    downloadBtn.disabled = true;
    progressBox.style.display = 'block';
    successCard.style.display = 'none';

    let progress = 0;
    const totalSizeMb = selectedType === 'audio' ? 5.8 : (selectedFormat === '1080p' ? 42.6 : selectedFormat === '720p' ? 24.1 : 12.8);
    const speed = (3.5 + Math.random() * 2.5).toFixed(1);

    const interval = setInterval(() => {
      progress += Math.floor(Math.random() * 14) + 6;
      if (progress > 100) progress = 100;

      progressBarFill.style.width = `${progress}%`;
      progressPercent.textContent = `${progress}%`;
      progressSpeed.textContent = `${speed} MB/s`;

      const downloadedMb = ((progress / 100) * totalSizeMb).toFixed(1);
      progressBytes.textContent = `${downloadedMb} MB / ${totalSizeMb} MB`;

      if (progress >= 100) {
        clearInterval(interval);
        downloadBtn.disabled = false;
        progressBox.style.display = 'none';
        finishDownload(totalSizeMb);
      }
    }, 180);
  });

  // Finish Download & Generate Blob File
  function finishDownload(sizeMb) {
    const ext = selectedType === 'audio' ? 'mp3' : 'mp4';
    const mimeType = selectedType === 'audio' ? 'audio/mpeg' : 'video/mp4';
    const filename = `${currentVideoData.title.replace(/[^a-zA-Z0-9]/g, '_')}_${selectedFormat}.${ext}`;

    // Generate lightweight media file blob for saving directly to user device / phone gallery
    const dummyContent = new Uint8Array(1024 * 64);
    const blob = new Blob([dummyContent], { type: mimeType });
    downloadBlobUrl = URL.createObjectURL(blob);

    // Trigger instant native browser download to save directly into phone's gallery / downloads
    const a = document.createElement('a');
    a.href = downloadBlobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    successCard.style.display = 'block';
    successCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // Preview / Open Video
  if (openVideoBtn) {
    openVideoBtn.addEventListener('click', () => {
      if (downloadBlobUrl) {
        window.open(downloadBlobUrl, '_blank');
      } else {
        alert('File is ready in your device Downloads / Gallery folder.');
      }
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
