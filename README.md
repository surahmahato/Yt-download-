# YT Download - Fast & Lightweight Video Downloader

[![Android](https://img.shields.io/badge/Platform-Android-green.svg)](https://developer.android.com)
[![Jetpack Compose](https://img.shields.io/badge/UI-Jetpack%20Compose-blue.svg)](https://developer.android.com/jetpack/compose)
[![Material 3](https://img.shields.io/badge/Design-Material%203-purple.svg)](https://m3.material.io)

**YT Download** is a fast, lightweight web and Android utility for saving public media directly to your device gallery:
- **YouTube & Shorts** (1080p Full HD, 720p HD, 480p, 360p MP4, and 320kbps MP3 audio)
- **TikTok (No Watermark)** (Clean original MP4 video and MP3 audio)
- **Direct Media Streams** (Playable MP4 and audio links)

---

## Key Features

- **Direct Phone Gallery Integration**: Saves media into your device's `MediaStore` (`Movies/YT_Download` or `Download`), making videos immediately visible in Google Photos and Gallery apps.
- **Multiple Resolution & Format Selection**: Choose between 1080p, 720p, 480p, 360p, and 320kbps MP3 audio.
- **Active Download Manager**: Live progress tracking showing percentage, downloaded bytes, total size, and download speed.
- **In-App Media Player & Sharing**: Preview downloaded videos with playback controls and share directly.

---

## Getting Started (Android)

### Prerequisites
- Android Studio Ladybug or newer
- JDK 17+
- Android SDK 26+

### Building the Project
```bash
gradle :app:assembleDebug
```
The compiled APK is output to `app/build/outputs/apk/debug/app-debug.apk`.

---

## Deploy as a Website on Render.com

This repository includes the lightweight Node.js web edition (`server.js` + `public/`) ready for **Render (render.com)**.

- **Environment:** Web Service (Node.js >= 18)
- **Build Command:** `npm install`
- **Start Command:** `npm start`

---

## License
MIT License
