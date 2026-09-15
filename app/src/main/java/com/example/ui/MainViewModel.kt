package com.example.ui

import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.example.data.db.AppDatabase
import com.example.data.db.VideoEntity
import com.example.data.firebase.FirebaseSecurityManager
import com.example.data.firebase.SecurityAuditReport
import com.example.data.network.AnalyzedVideoMetadata
import com.example.data.network.DownloadState
import com.example.data.network.VideoDownloadManager
import com.example.data.network.VideoFormatOption
import com.example.data.repository.VideoRepository
import com.example.data.security.CryptoManager
import com.example.data.storage.GallerySaver
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.io.File

class MainViewModel(application: Application) : AndroidViewModel(application) {

    private val context = application.applicationContext
    private val database = AppDatabase.getInstance(context)
    private val repository = VideoRepository(database.videoDao())
    val downloadManager = VideoDownloadManager(context)

    // Flow states for database
    val galleryVideos: StateFlow<List<VideoEntity>> = repository.galleryVideos
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    // Download state from download manager
    val downloadState: StateFlow<DownloadState> = downloadManager.downloadState

    // Security audit state
    val securityAudit: StateFlow<SecurityAuditReport> = FirebaseSecurityManager.auditReport

    // Downloader Screen Input States
    private val _urlInput = MutableStateFlow("")
    val urlInput: StateFlow<String> = _urlInput.asStateFlow()

    private val _analyzedMetadata = MutableStateFlow<AnalyzedVideoMetadata?>(null)
    val analyzedMetadata: StateFlow<AnalyzedVideoMetadata?> = _analyzedMetadata.asStateFlow()

    private val _selectedFormat = MutableStateFlow<VideoFormatOption?>(null)
    val selectedFormat: StateFlow<VideoFormatOption?> = _selectedFormat.asStateFlow()

    private val _errorMessage = MutableStateFlow<String?>(null)
    val errorMessage: StateFlow<String?> = _errorMessage.asStateFlow()

    private val _snackbarMessage = MutableStateFlow<String?>(null)
    val snackbarMessage: StateFlow<String?> = _snackbarMessage.asStateFlow()

    // Active player dialog state
    private val _activePlayingVideo = MutableStateFlow<PlayingVideoState?>(null)
    val activePlayingVideo: StateFlow<PlayingVideoState?> = _activePlayingVideo.asStateFlow()

    data class PlayingVideoState(
        val title: String,
        val videoUri: Uri? = null,
        val filePath: String? = null
    )

    init {
        FirebaseSecurityManager.refreshAudit(context)
    }

    fun onUrlChanged(newUrl: String) {
        _urlInput.value = newUrl
        _errorMessage.value = null
    }

    fun clearUrl() {
        _urlInput.value = ""
        _analyzedMetadata.value = null
        _selectedFormat.value = null
        _errorMessage.value = null
    }

    fun analyzeCurrentUrl() {
        val raw = _urlInput.value.trim()
        if (raw.isEmpty()) {
            _errorMessage.value = "Please enter or paste a video URL"
            return
        }

        val validation = CryptoManager.validateAndSanitizeUrl(raw)
        if (!validation.isValid) {
            _errorMessage.value = validation.errorReason ?: "Invalid URL"
            return
        }

        val metadata = downloadManager.analyzeUrl(raw)
        if (metadata != null) {
            _analyzedMetadata.value = metadata
            _selectedFormat.value = metadata.formats.firstOrNull()
            _errorMessage.value = null
        } else {
            _errorMessage.value = "Unable to parse video stream from this link."
        }
    }

    fun selectFormat(format: VideoFormatOption) {
        _selectedFormat.value = format
    }

    fun startDownload() {
        val metadata = _analyzedMetadata.value ?: return
        val format = _selectedFormat.value ?: return

        viewModelScope.launch {
            val success = downloadManager.downloadVideo(
                metadata = metadata,
                selectedFormat = format
            )

            if (success) {
                val state = downloadManager.downloadState.value
                if (state is DownloadState.Completed) {
                    val entity = VideoEntity(
                        title = metadata.title,
                        originalUrl = metadata.originalUrl,
                        platform = metadata.platform,
                        galleryUriString = state.galleryUri?.toString(),
                        localFilePath = state.file.absolutePath,
                        fileSizeBytes = state.file.length(),
                        durationText = metadata.durationText,
                        quality = format.label,
                        isEncryptedInVault = false,
                        encryptedFilePath = null
                    )
                    repository.insertVideo(entity)
                    _snackbarMessage.value = "Success! Video saved directly to your Phone Gallery!"
                }
            }
        }
    }

    fun cancelDownload() {
        downloadManager.cancelDownload()
    }

    fun resetDownloadState() {
        downloadManager.resetState()
    }

    fun dismissSnackbar() {
        _snackbarMessage.value = null
    }

    fun deleteVideo(video: VideoEntity) {
        viewModelScope.launch {
            if (video.localFilePath.isNotBlank()) {
                File(video.localFilePath).delete()
            }
            video.galleryUriString?.let { uriStr ->
                GallerySaver.deleteFromGallery(context, Uri.parse(uriStr))
            }
            repository.deleteVideo(video)
            _snackbarMessage.value = "Video removed from gallery."
        }
    }

    fun playVideo(video: VideoEntity) {
        val uri = video.galleryUriString?.let { Uri.parse(it) }
        _activePlayingVideo.value = PlayingVideoState(
            title = video.title,
            videoUri = uri,
            filePath = video.localFilePath
        )
    }

    fun openInPhoneGallery(video: VideoEntity) {
        val uri = video.galleryUriString?.let { Uri.parse(it) }
        if (uri != null) {
            GallerySaver.openVideoInGallery(context, uri)
        } else if (video.localFilePath.isNotBlank()) {
            val file = File(video.localFilePath)
            if (file.exists()) {
                viewModelScope.launch {
                    val newUri = GallerySaver.saveVideoToGallery(
                        context = context,
                        sourceFile = file,
                        title = video.title
                    )
                    if (newUri != null) {
                        repository.updateVideo(video.copy(galleryUriString = newUri.toString()))
                        GallerySaver.openVideoInGallery(context, newUri)
                    } else {
                        _snackbarMessage.value = "Unable to open video in gallery."
                    }
                }
            }
        }
    }

    fun openInPhoneGallery(uri: Uri) {
        GallerySaver.openVideoInGallery(context, uri)
    }

    fun openPhoneGalleryApp() {
        GallerySaver.openPhoneGalleryApp(context)
    }

    fun reExportToGallery(video: VideoEntity) {
        viewModelScope.launch {
            val file = File(video.localFilePath)
            if (file.exists()) {
                val newUri = GallerySaver.saveVideoToGallery(
                    context = context,
                    sourceFile = file,
                    title = video.title
                )
                if (newUri != null) {
                    repository.updateVideo(video.copy(galleryUriString = newUri.toString()))
                    _snackbarMessage.value = "Saved into Phone Gallery (Movies/YT_Download)!"
                } else {
                    _snackbarMessage.value = "Failed to export to gallery."
                }
            } else {
                _snackbarMessage.value = "Video file not found."
            }
        }
    }

    fun closePlayer() {
        _activePlayingVideo.value = null
    }
}
