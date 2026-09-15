package com.example.data.repository

import com.example.data.db.VideoDao
import com.example.data.db.VideoEntity
import kotlinx.coroutines.flow.Flow

class VideoRepository(private val videoDao: VideoDao) {
    val allVideos: Flow<List<VideoEntity>> = videoDao.getAllVideos()
    val galleryVideos: Flow<List<VideoEntity>> = videoDao.getGalleryVideos()
    val vaultVideos: Flow<List<VideoEntity>> = videoDao.getVaultVideos()

    suspend fun getVideoById(id: Long): VideoEntity? = videoDao.getVideoById(id)

    suspend fun insertVideo(video: VideoEntity): Long = videoDao.insertVideo(video)

    suspend fun updateVideo(video: VideoEntity) = videoDao.updateVideo(video)

    suspend fun deleteVideo(video: VideoEntity) = videoDao.deleteVideo(video)

    suspend fun deleteVideoById(id: Long) = videoDao.deleteVideoById(id)
}
