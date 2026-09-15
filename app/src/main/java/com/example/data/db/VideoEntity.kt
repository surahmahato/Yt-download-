package com.example.data.db

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "downloaded_videos")
data class VideoEntity(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    val title: String,
    val originalUrl: String,
    val platform: String,
    val galleryUriString: String?,
    val localFilePath: String,
    val fileSizeBytes: Long,
    val durationText: String,
    val quality: String,
    val isEncryptedInVault: Boolean = false,
    val encryptedFilePath: String? = null,
    val createdAt: Long = System.currentTimeMillis()
)
