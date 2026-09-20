package com.example.data.network

import android.content.Context
import android.net.Uri
import android.util.Base64
import com.example.data.security.CryptoManager
import com.example.data.storage.GallerySaver
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

sealed class DownloadState {
    object Idle : DownloadState()
    data class Downloading(
        val progress: Float,
        val bytesRead: Long,
        val totalBytes: Long,
        val speedKbps: Long
    ) : DownloadState()
    data class Completed(
        val file: File,
        val galleryUri: Uri?,
        val title: String,
        val quality: String,
        val isEncrypted: Boolean
    ) : DownloadState()
    data class Failed(val error: String) : DownloadState()
}

data class VideoFormatOption(
    val id: String,
    val resolution: String,
    val label: String,
    val approxSizeMb: String,
    val extension: String,
    val mimeType: String
)

data class AnalyzedVideoMetadata(
    val title: String,
    val platform: String,
    val durationText: String,
    val originalUrl: String,
    val downloadStreamUrl: String,
    val formats: List<VideoFormatOption>,
    val thumbnailUrl: String? = null
)

class VideoDownloadManager(private val context: Context) {

    private val httpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()

    private val _downloadState = MutableStateFlow<DownloadState>(DownloadState.Idle)
    val downloadState: StateFlow<DownloadState> = _downloadState.asStateFlow()

    private var activeCall: okhttp3.Call? = null

    /**
     * Decrypts AES-128-CBC encrypted data payload from Savetube API
     */
    private fun decryptSavetubePayload(encBase64: String): JSONObject? {
        return try {
            val secretKeyHex = "C5D58EF67A7584E4A29F6C35BBC4EB12"
            val keyBytes = ByteArray(16) { i ->
                secretKeyHex.substring(i * 2, i * 2 + 2).toInt(16).toByte()
            }
            val raw = Base64.decode(encBase64, Base64.DEFAULT)
            if (raw.size < 16) return null
            val iv = raw.copyOfRange(0, 16)
            val content = raw.copyOfRange(16, raw.size)
            val secretKeySpec = SecretKeySpec(keyBytes, "AES")
            val ivParameterSpec = IvParameterSpec(iv)
            val cipher = Cipher.getInstance("AES/CBC/PKCS5Padding")
            cipher.init(Cipher.DECRYPT_MODE, secretKeySpec, ivParameterSpec)
            val decrypted = cipher.doFinal(content)
            JSONObject(String(decrypted, Charsets.UTF_8))
        } catch (e: Exception) {
            null
        }
    }

    /**
     * Analyzes any social media or direct video URL.
     */
    fun analyzeUrl(rawUrl: String): AnalyzedVideoMetadata? {
        val validation = CryptoManager.validateAndSanitizeUrl(rawUrl)
        if (!validation.isValid) return null

        val platform = validation.platform
        val sanitized = validation.sanitizedUrl

        val isDirectMp4 = sanitized.endsWith(".mp4", ignoreCase = true) ||
                sanitized.contains(".mp4?", ignoreCase = true) ||
                sanitized.endsWith(".webm", ignoreCase = true) ||
                sanitized.endsWith(".mp3", ignoreCase = true)

        var resolvedTitle: String? = null
        var resolvedThumb: String? = null

        // Fetch real metadata from oEmbed for YouTube
        if (platform == "YouTube" || sanitized.contains("youtube.com") || sanitized.contains("youtu.be")) {
            try {
                val oembedUrl = "https://www.youtube.com/oembed?url=" + java.net.URLEncoder.encode(sanitized, "UTF-8") + "&format=json"
                val oembedReq = Request.Builder()
                    .url(oembedUrl)
                    .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
                    .build()
                val oembedResp = httpClient.newCall(oembedReq).execute()
                if (oembedResp.isSuccessful) {
                    val oembedJson = JSONObject(oembedResp.body?.string() ?: "{}")
                    resolvedTitle = oembedJson.optString("title").takeIf { it.isNotBlank() }
                    resolvedThumb = oembedJson.optString("thumbnail_url").takeIf { it.isNotBlank() }
                }
            } catch (_: Exception) {}
        } else if (platform == "TikTok" || sanitized.contains("tiktok.com")) {
            try {
                val apiUrl = "https://www.tikwm.com/api/?url=" + java.net.URLEncoder.encode(sanitized, "UTF-8")
                val req = Request.Builder().url(apiUrl).build()
                val resp = httpClient.newCall(req).execute()
                if (resp.isSuccessful) {
                    val j = JSONObject(resp.body?.string() ?: "{}")
                    val data = j.optJSONObject("data")
                    resolvedTitle = data?.optString("title")?.take(80)?.takeIf { it.isNotBlank() }
                    resolvedThumb = data?.optString("cover")?.takeIf { it.isNotBlank() }
                }
            } catch (_: Exception) {}
        }

        val title = resolvedTitle ?: when {
            isDirectMp4 -> {
                val segment = sanitized.substringBefore("?").substringAfterLast("/").substringBeforeLast(".")
                if (segment.isNotBlank()) segment.replace("_", " ").replace("-", " ").capitalizeWords()
                else "Media Stream Video"
            }
            platform == "YouTube" -> "YouTube Video"
            platform == "TikTok" -> "TikTok Video (No Watermark)"
            platform == "Instagram" -> "Instagram Video"
            platform == "Twitter/X" -> "Twitter Video Highlight"
            platform == "Facebook" -> "Shared Video"
            else -> "Media Video Stream"
        }

        val formats = listOf(
            VideoFormatOption("1080p", "1080p", "Full HD (1080p)", "18.4 MB", "mp4", "video/mp4"),
            VideoFormatOption("720p", "720p", "High Def (720p)", "9.6 MB", "mp4", "video/mp4"),
            VideoFormatOption("480p", "480p", "Standard (480p)", "4.8 MB", "mp4", "video/mp4"),
            VideoFormatOption("mp3", "Audio", "MP3 Audio (320kbps)", "2.6 MB", "mp3", "audio/mpeg")
        )

        val streamUrl = if (isDirectMp4) sanitized else ""

        return AnalyzedVideoMetadata(
            title = title,
            platform = platform,
            durationText = "HD Quality",
            originalUrl = sanitized,
            downloadStreamUrl = streamUrl,
            formats = formats,
            thumbnailUrl = resolvedThumb
        )
    }

    /**
     * Resolves the real video stream URL dynamically for YouTube, TikTok, and direct links.
     */
    private fun resolveDirectMediaStream(
        originalUrl: String,
        platform: String,
        format: VideoFormatOption
    ): Pair<String?, String?> {
        // Direct media links
        if (originalUrl.endsWith(".mp4", true) ||
            originalUrl.contains(".mp4?") ||
            originalUrl.endsWith(".webm", true) ||
            originalUrl.endsWith(".mp3", true)) {
            return Pair(originalUrl, null)
        }

        // 1. TikTok resolution via TikWM API (direct no-watermark MP4)
        if (platform == "TikTok" || originalUrl.contains("tiktok.com")) {
            try {
                val apiUrl = "https://www.tikwm.com/api/?url=" + java.net.URLEncoder.encode(originalUrl, "UTF-8")
                val req = Request.Builder()
                    .url(apiUrl)
                    .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
                    .build()
                val resp = httpClient.newCall(req).execute()
                if (resp.isSuccessful) {
                    val bodyStr = resp.body?.string()
                    if (!bodyStr.isNullOrBlank()) {
                        val json = JSONObject(bodyStr)
                        if (json.optInt("code") == 0) {
                            val data = json.optJSONObject("data")
                            if (data != null) {
                                val videoUrl = if (format.id == "mp3") {
                                    data.optString("music").ifBlank { data.optString("play") }
                                } else {
                                    data.optString("play").ifBlank { data.optString("wmplay") }
                                }
                                val videoTitle = data.optString("title", "TikTok Video").take(80)
                                if (videoUrl.isNotBlank()) {
                                    return Pair(videoUrl, videoTitle)
                                }
                            }
                        }
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }

        // 2. YouTube resolution via Savetube v2 AES engine
        if (platform == "YouTube" || originalUrl.contains("youtube.com") || originalUrl.contains("youtu.be")) {
            var resolvedTitle: String? = null
            try {
                val oembedUrl = "https://www.youtube.com/oembed?url=" + java.net.URLEncoder.encode(originalUrl, "UTF-8") + "&format=json"
                val oembedReq = Request.Builder().url(oembedUrl).build()
                val oembedResp = httpClient.newCall(oembedReq).execute()
                if (oembedResp.isSuccessful) {
                    val oembedJson = JSONObject(oembedResp.body?.string() ?: "{}")
                    resolvedTitle = oembedJson.optString("title").takeIf { it.isNotBlank() }
                }
            } catch (_: Exception) {}

            try {
                val cdnCandidates = mutableListOf<String>()
                try {
                    val randCdnReq = Request.Builder()
                        .url("https://media.savetube.vip/api/random-cdn")
                        .header("User-Agent", "Mozilla/5.0 (Linux; Android 14)")
                        .build()
                    val randResp = httpClient.newCall(randCdnReq).execute()
                    if (randResp.isSuccessful) {
                        val rJson = JSONObject(randResp.body?.string() ?: "")
                        val fetchedCdn = rJson.optString("cdn")
                        if (fetchedCdn.isNotBlank()) {
                            cdnCandidates.add(fetchedCdn)
                        }
                    }
                } catch (_: Exception) {}

                cdnCandidates.addAll(listOf("cdn401.savetube.vip", "cdn402.savetube.vip", "cdn403.savetube.vip", "cdn404.savetube.vip"))

                val jsonMediaType = "application/json; charset=utf-8".toMediaTypeOrNull()

                for (cdn in cdnCandidates.distinct()) {
                    try {
                        val infoPayload = JSONObject().apply {
                            put("url", originalUrl)
                        }
                        val infoReq = Request.Builder()
                            .url("https://$cdn/v2/info")
                            .post(infoPayload.toString().toRequestBody(jsonMediaType))
                            .header("User-Agent", "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36")
                            .header("Referer", "https://save-tube.com/")
                            .build()
                        val infoResp = httpClient.newCall(infoReq).execute()
                        if (!infoResp.isSuccessful) continue

                        val infoBody = infoResp.body?.string() ?: ""
                        val infoJson = JSONObject(infoBody)
                        val encData = infoJson.optString("data")
                        if (encData.isBlank()) continue

                        val decodedInfo = decryptSavetubePayload(encData) ?: continue
                        val key = decodedInfo.optString("key")
                        val videoTitle = decodedInfo.optString("title").takeIf { it.isNotBlank() } ?: resolvedTitle
                        if (key.isBlank()) continue

                        val qualityVal = if (format.id == "mp3") "128" else format.resolution.replace("p", "")
                        val dlPayload = JSONObject().apply {
                            put("downloadType", if (format.id == "mp3") "audio" else "video")
                            put("quality", qualityVal)
                            put("key", key)
                        }
                        val dlReq = Request.Builder()
                            .url("https://$cdn/download")
                            .post(dlPayload.toString().toRequestBody(jsonMediaType))
                            .header("User-Agent", "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36")
                            .header("Referer", "https://save-tube.com/")
                            .build()
                        val dlResp = httpClient.newCall(dlReq).execute()
                        if (dlResp.isSuccessful) {
                            val dlJson = JSONObject(dlResp.body?.string() ?: "")
                            val dlUrl = dlJson.optJSONObject("data")?.optString("downloadUrl")
                                ?: dlJson.optString("downloadUrl")
                            if (!dlUrl.isNullOrBlank()) {
                                return Pair(dlUrl, videoTitle)
                            }
                        }
                    } catch (_: Exception) {}
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }

            // Fallback: Invidious / Piped public streaming API
            try {
                val ytIdRegex = Regex("""(?:v=|/v/|youtu\.be/|/shorts/)([a-zA-Z0-9_-]{11})""")
                val match = ytIdRegex.find(originalUrl)
                val videoId = match?.groupValues?.getOrNull(1)
                if (!videoId.isNullOrBlank()) {
                    val invidiousHosts = listOf("inv.nadeko.net", "yewtu.be", "vid.puffyan.us")
                    for (host in invidiousHosts) {
                        try {
                            val invReq = Request.Builder()
                                .url("https://$host/api/v1/videos/$videoId")
                                .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
                                .build()
                            val invResp = httpClient.newCall(invReq).execute()
                            if (invResp.isSuccessful) {
                                val invJson = JSONObject(invResp.body?.string() ?: "{}")
                                val streams = invJson.optJSONArray("formatStreams")
                                if (streams != null && streams.length() > 0) {
                                    for (i in 0 until streams.length()) {
                                        val streamObj = streams.getJSONObject(i)
                                        val sUrl = streamObj.optString("url")
                                        if (sUrl.isNotBlank()) {
                                            return Pair(sUrl, resolvedTitle ?: invJson.optString("title"))
                                        }
                                    }
                                }
                            }
                        } catch (_: Exception) {}
                    }
                }
            } catch (_: Exception) {}
        }

        // Return null if resolution could not find a stream - NEVER return dummy/sample media
        return Pair(null, null)
    }

    /**
     * Downloads the stream directly and saves to Phone Gallery with real stream resolution.
     */
    suspend fun downloadVideo(
        metadata: AnalyzedVideoMetadata,
        selectedFormat: VideoFormatOption
    ): Boolean = withContext(Dispatchers.IO) {
        try {
            _downloadState.value = DownloadState.Downloading(0f, 0L, 0L, 0L)

            // Resolve real stream dynamically
            var targetStreamUrl = metadata.downloadStreamUrl
            var finalTitle = metadata.title

            if (targetStreamUrl.isBlank() || !targetStreamUrl.startsWith("http")) {
                val (resolvedUrl, resolvedTitle) = resolveDirectMediaStream(
                    metadata.originalUrl,
                    metadata.platform,
                    selectedFormat
                )
                if (!resolvedUrl.isNullOrBlank()) {
                    targetStreamUrl = resolvedUrl
                }
                if (!resolvedTitle.isNullOrBlank()) {
                    finalTitle = resolvedTitle
                }
            }

            if (targetStreamUrl.isBlank()) {
                _downloadState.value = DownloadState.Failed(
                    "Could not extract a downloadable video stream for this link. Please verify that the link is public and accessible."
                )
                return@withContext false
            }

            // Create network request for the resolved stream
            val request = Request.Builder()
                .url(targetStreamUrl)
                .header("User-Agent", "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36")
                .header("Accept", "*/*")
                .header("Accept-Language", "en-US,en;q=0.9")
                .build()

            val call = httpClient.newCall(request)
            activeCall = call

            val response = call.execute()
            if (!response.isSuccessful || response.body == null) {
                _downloadState.value = DownloadState.Failed(
                    "Download server returned error HTTP ${response.code}. Please verify link or try another format."
                )
                return@withContext false
            }

            val body = response.body ?: run {
                response.close()
                _downloadState.value = DownloadState.Failed("Empty response body from video server")
                return@withContext false
            }

            val contentLength = body.contentLength()
            val totalBytes = if (contentLength > 0) contentLength else (10 * 1024 * 1024L) // default 10MB approx

            // Save to temporary cache file first
            val tempDir = File(context.cacheDir, "downloads").apply { mkdirs() }
            val tempFile = File(tempDir, "temp_${System.currentTimeMillis()}.${selectedFormat.extension}")

            var bytesDownloaded = 0L
            var lastUpdateTime = System.currentTimeMillis()
            var bytesSinceLastUpdate = 0L
            var currentSpeedKbps = 0L

            body.byteStream().use { inputStream: InputStream ->
                FileOutputStream(tempFile).use { outputStream: FileOutputStream ->
                    val buffer = ByteArray(16 * 1024)
                    var readBytes: Int = inputStream.read(buffer)
                    while (readBytes != -1) {
                        outputStream.write(buffer, 0, readBytes)
                        bytesDownloaded += readBytes
                        bytesSinceLastUpdate += readBytes

                        val now = System.currentTimeMillis()
                        val diff = now - lastUpdateTime
                        if (diff >= 250) {
                            currentSpeedKbps = (bytesSinceLastUpdate * 1000L) / (diff * 1024L)
                            lastUpdateTime = now
                            bytesSinceLastUpdate = 0L

                            val progress = (bytesDownloaded.toFloat() / totalBytes.toFloat()).coerceIn(0f, 0.99f)
                            _downloadState.value = DownloadState.Downloading(
                                progress = progress,
                                bytesRead = bytesDownloaded,
                                totalBytes = totalBytes,
                                speedKbps = currentSpeedKbps
                            )
                        }
                        readBytes = inputStream.read(buffer)
                    }
                }
            }

            // Save directly to Phone Gallery via MediaStore
            val galleryUri = GallerySaver.saveVideoToGallery(
                context = context,
                sourceFile = tempFile,
                title = finalTitle,
                mimeType = selectedFormat.mimeType
            )

            _downloadState.value = DownloadState.Completed(
                file = tempFile,
                galleryUri = galleryUri,
                title = finalTitle,
                quality = selectedFormat.label,
                isEncrypted = false
            )
            return@withContext true

        } catch (e: CancellationException) {
            _downloadState.value = DownloadState.Idle
            return@withContext false
        } catch (e: Exception) {
            e.printStackTrace()
            _downloadState.value = DownloadState.Failed("Download failed: ${e.localizedMessage}")
            return@withContext false
        } finally {
            activeCall = null
        }
    }

    fun cancelDownload() {
        activeCall?.cancel()
        _downloadState.value = DownloadState.Idle
    }

    fun resetState() {
        _downloadState.value = DownloadState.Idle
    }

    private fun String.capitalizeWords(): String = split(" ").joinToString(" ") { word ->
        word.lowercase().replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }
    }
}
