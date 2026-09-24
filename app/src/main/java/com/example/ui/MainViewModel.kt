package com.example.ui

import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.example.data.db.AppDatabase
import com.example.data.db.VideoEntity
import com.example.data.network.AnalyzedVideoMetadata
import com.example.data.network.DownloadState
import com.example.data.network.VideoDownloadManager
import com.example.data.network.VideoFormatOption
import com.example.data.repository.VideoRepository
import com.example.data.storage.GallerySaver
import com.example.ui.components.VideoPlayingState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

class MainViewModel(application: Application) : AndroidViewModel(application) {

    private val repository: VideoRepository = VideoRepository(
        AppDatabase.getDatabase(application).videoDao()
    )
    private val downloadManager: VideoDownloadManager = VideoDownloadManager(application)

    val savedVideos: StateFlow<List<VideoEntity>> = repository.allVideos
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    private val _urlInput = MutableStateFlow("")
    val urlInput: StateFlow<String> = _urlInput.asStateFlow()

    private val _isAnalyzing = MutableStateFlow(false)
    val isAnalyzing: StateFlow<Boolean> = _isAnalyzing.asStateFlow()

    private val _analyzedMetadata = MutableStateFlow<AnalyzedVideoMetadata?>(null)
    val analyzedMetadata: StateFlow<AnalyzedVideoMetadata?> = _analyzedMetadata.asStateFlow()

    private val _selectedFormat = MutableStateFlow<VideoFormatOption?>(null)
    val selectedFormat: StateFlow<VideoFormatOption?> = _selectedFormat.asStateFlow()

    val downloadState: StateFlow<DownloadState> = downloadManager.downloadState

    private val _errorMessage = MutableStateFlow<String?>(null)
    val errorMessage: StateFlow<String?> = _errorMessage.asStateFlow()

    private val _snackbarMessage = MutableStateFlow<String?>(null)
    val snackbarMessage: StateFlow<String?> = _snackbarMessage.asStateFlow()

    private val _activePlayingVideo = MutableStateFlow<VideoPlayingState?>(null)
    val activePlayingVideo: StateFlow<VideoPlayingState?> = _activePlayingVideo.asStateFlow()

    init {
        // Observe download state to automatically record completed downloads to database
        viewModelScope.launch {
            downloadManager.downloadState.collect { state ->
                if (state is DownloadState.Completed) {
                    val meta = _analyzedMetadata.value
                    val videoEntity = VideoEntity(
                        title = state.title,
                        originalUrl = meta?.originalUrl ?: _urlInput.value,
                        platform = meta?.platform ?: "Media",
                        galleryUriString = state.galleryUri?.toString(),
                        localFilePath = state.file.absolutePath,
                        fileSizeBytes = state.file.length(),
                        durationText = meta?.durationText ?: "00:15",
                        quality = state.quality,
                        isEncryptedInVault = false
                    )
                    repository.insertVideo(videoEntity)
                    _snackbarMessage.value = "Saved to Phone Gallery: ${state.title}"
                }
            }
        }
    }

    fun onUrlChanged(url: String) {
        _urlInput.value = url
        _errorMessage.value = null
    }

    fun clearUrl() {
        _urlInput.value = ""
        _errorMessage.value = null
        _analyzedMetadata.value = null
        _selectedFormat.value = null
    }

    fun analyzeCurrentUrl() {
        val input = _urlInput.value.trim()
        if (input.isEmpty()) {
            _errorMessage.value = "Please enter or paste any video URL to download"
            return
        }

        viewModelScope.launch {
            _isAnalyzing.value = true
            _errorMessage.value = null
            val result = withContext(Dispatchers.IO) {
                downloadManager.analyzeUrl(input)
            }
            _isAnalyzing.value = false
            _errorMessage.value = null
            _analyzedMetadata.value = result
            _selectedFormat.value = result.formats.firstOrNull { it.quality == "720" } ?: result.formats.firstOrNull()
        }
    }

    fun selectFormat(format: VideoFormatOption) {
        _selectedFormat.value = format
    }

    fun fastOneClickDownload(formatType: String) { // "hd" or "mp3"
        val input = _urlInput.value.trim()
        if (input.isEmpty()) {
            _errorMessage.value = "Please paste or enter any video link first"
            return
        }
        viewModelScope.launch {
            _isAnalyzing.value = true
            _errorMessage.value = null
            val meta = withContext(Dispatchers.IO) {
                downloadManager.analyzeUrl(input)
            }
            _isAnalyzing.value = false
            _analyzedMetadata.value = meta
            val format: VideoFormatOption = when {
                formatType == "mp3" -> meta.formats.firstOrNull { it.extension == "mp3" } ?: meta.formats.lastOrNull()
                formatType == "photo" || meta.isPhoto -> meta.formats.firstOrNull { it.type == "photo" } ?: meta.formats.firstOrNull()
                else -> meta.formats.firstOrNull { it.resolution.contains("1080") }
                    ?: meta.formats.firstOrNull { it.resolution.contains("720") }
                    ?: meta.formats.firstOrNull()
            } ?: return@launch
            _selectedFormat.value = format
            downloadManager.downloadVideo(meta, format)
        }
    }

    fun startDownload() {
        val metadata = _analyzedMetadata.value ?: return
        val format = _selectedFormat.value ?: metadata.formats.firstOrNull() ?: return

        viewModelScope.launch {
            downloadManager.downloadVideo(metadata, format)
        }
    }

    fun cancelDownload() {
        downloadManager.cancelDownload()
    }

    fun resetDownloadState() {
        downloadManager.resetState()
    }

    fun openInPhoneGallery(uri: Uri) {
        GallerySaver.openVideoInGallery(getApplication(), uri)
    }

    fun openPhoneGalleryApp() {
        GallerySaver.openPhoneGalleryApp(getApplication())
    }

    fun playVideo(video: VideoEntity) {
        val uri = video.galleryUriString?.let { Uri.parse(it) } ?: Uri.fromFile(File(video.localFilePath))
        _activePlayingVideo.value = VideoPlayingState(
            uri = uri,
            title = video.title,
            filePath = video.localFilePath
        )
    }

    fun closePlayer() {
        _activePlayingVideo.value = null
    }

    fun shareVideo(video: VideoEntity) {
        val uri = video.galleryUriString?.let { Uri.parse(it) } ?: Uri.fromFile(File(video.localFilePath))
        GallerySaver.shareVideo(getApplication(), uri, video.title)
    }

    fun deleteVideo(video: VideoEntity) {
        viewModelScope.launch {
            video.galleryUriString?.let { uriStr ->
                try {
                    GallerySaver.deleteFromGallery(getApplication(), Uri.parse(uriStr))
                } catch (_: Exception) {}
            }
            try {
                File(video.localFilePath).delete()
            } catch (_: Exception) {}

            repository.deleteVideo(video)
            _snackbarMessage.value = "Removed ${video.title}"
        }
    }

    fun dismissSnackbar() {
        _snackbarMessage.value = null
    }
}
