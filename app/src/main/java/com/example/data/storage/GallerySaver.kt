package com.example.data.storage

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream

object GallerySaver {

    /**
     * Copies a downloaded video/audio file directly into the Android Phone Gallery (MediaStore).
     * The media is indexed into Movies/YT_Download (or Music/YT_Download) and scanned so it
     * immediately appears in Google Photos, Samsung Gallery, and native device gallery apps.
     */
    suspend fun saveVideoToGallery(
        context: Context,
        sourceFile: File,
        title: String,
        mimeType: String = "video/mp4",
        subFolder: String = "YT_Download"
    ): Uri? = withContext(Dispatchers.IO) {
        val resolver = context.contentResolver
        val cleanTitle = title.replace(Regex("[^a-zA-Z0-9._-]"), "_").take(50)
        val isAudio = mimeType.startsWith("audio")
        val extension = if (isAudio) "mp3" else "mp4"
        val fileName = "${cleanTitle}_${System.currentTimeMillis()}.$extension"
        val nowSeconds = System.currentTimeMillis() / 1000

        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.TITLE, title)
            put(MediaStore.MediaColumns.DISPLAY_NAME, fileName)
            put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
            put(MediaStore.MediaColumns.DATE_ADDED, nowSeconds)
            put(MediaStore.MediaColumns.DATE_MODIFIED, nowSeconds)

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val baseDir = if (isAudio) Environment.DIRECTORY_MUSIC else Environment.DIRECTORY_MOVIES
                put(MediaStore.MediaColumns.RELATIVE_PATH, "$baseDir/$subFolder")
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
        }

        val collectionUri = if (isAudio) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
            } else {
                MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
            }
        } else {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
            } else {
                MediaStore.Video.Media.EXTERNAL_CONTENT_URI
            }
        }

        var itemUri: Uri? = null

        try {
            itemUri = resolver.insert(collectionUri, values)

            if (itemUri != null) {
                resolver.openOutputStream(itemUri, "w")?.use { outputStream ->
                    FileInputStream(sourceFile).use { inputStream ->
                        inputStream.copyTo(outputStream)
                        outputStream.flush()
                    }
                }

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    values.clear()
                    values.put(MediaStore.MediaColumns.IS_PENDING, 0)
                    resolver.update(itemUri, values, null, null)
                }

                // Query the actual filesystem path to trigger MediaScannerConnection
                val realPath = getRealPathFromUri(context, itemUri)
                val pathsToScan = mutableListOf<String>()
                if (!realPath.isNullOrBlank()) {
                    pathsToScan.add(realPath)
                }
                pathsToScan.add(sourceFile.absolutePath)

                MediaScannerConnection.scanFile(
                    context,
                    pathsToScan.toTypedArray(),
                    arrayOf(mimeType)
                ) { _, _ -> }

                // Broadcast scan for legacy and varied Android vendor skins (Samsung, Xiaomi, Oppo)
                try {
                    val scanIntent = Intent(Intent.ACTION_MEDIA_SCANNER_SCAN_FILE, itemUri)
                    context.sendBroadcast(scanIntent)
                } catch (_: Exception) {}

                return@withContext itemUri
            }
        } catch (e: Exception) {
            e.printStackTrace()
            if (itemUri != null) {
                try {
                    resolver.delete(itemUri, null, null)
                } catch (_: Exception) {}
            }
        }

        // Fallback for Android 9 and lower or if MediaStore insert failed
        try {
            val baseDir = if (isAudio) {
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC)
            } else {
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES)
            }
            val targetFolder = File(baseDir, subFolder).apply { mkdirs() }
            val targetFile = File(targetFolder, fileName)

            FileInputStream(sourceFile).use { input ->
                FileOutputStream(targetFile).use { output ->
                    input.copyTo(output)
                    output.flush()
                }
            }

            var fallbackUri: Uri? = null
            MediaScannerConnection.scanFile(
                context,
                arrayOf(targetFile.absolutePath),
                arrayOf(mimeType)
            ) { _, uri ->
                fallbackUri = uri
            }

            fallbackUri ?: Uri.fromFile(targetFile)
        } catch (e: Exception) {
            e.printStackTrace()
            null
        }
    }

    private fun getRealPathFromUri(context: Context, uri: Uri): String? {
        return try {
            val projection = arrayOf(MediaStore.MediaColumns.DATA)
            context.contentResolver.query(uri, projection, null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val colIndex = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DATA)
                    cursor.getString(colIndex)
                } else null
            }
        } catch (e: Exception) {
            null
        }
    }

    /**
     * Directly opens the video in the Android Phone's integrated Gallery app or video player.
     */
    fun openVideoInGallery(context: Context, uri: Uri, mimeType: String = "video/*") {
        try {
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, mimeType)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(Intent.createChooser(intent, "Open in Phone Gallery"))
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    /**
     * Launches the phone's native integrated gallery application.
     */
    fun openPhoneGalleryApp(context: Context) {
        try {
            val intent = Intent(Intent.ACTION_MAIN).apply {
                addCategory(Intent.CATEGORY_APP_GALLERY)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
        } catch (e: Exception) {
            try {
                val fallback = Intent(Intent.ACTION_VIEW).apply {
                    type = "video/*"
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(Intent.createChooser(fallback, "Open Phone Gallery"))
            } catch (_: Exception) {}
        }
    }

    /**
     * Checks if a video Uri exists in MediaStore.
     */
    fun isUriAccessible(context: Context, uri: Uri): Boolean {
        return try {
            context.contentResolver.openInputStream(uri)?.use { true } ?: false
        } catch (e: Exception) {
            false
        }
    }

    /**
     * Shares a video via Intent.ACTION_SEND.
     */
    fun shareVideo(context: Context, uri: Uri, title: String) {
        try {
            val intent = Intent(Intent.ACTION_SEND).apply {
                type = "video/*"
                putExtra(Intent.EXTRA_STREAM, uri)
                putExtra(Intent.EXTRA_SUBJECT, title)
                putExtra(Intent.EXTRA_TEXT, "Shared video: $title")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(Intent.createChooser(intent, "Share Video via").apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            })
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    /**
     * Deletes a video from the gallery MediaStore.
     */
    fun deleteFromGallery(context: Context, uri: Uri): Boolean {
        return try {
            val count = context.contentResolver.delete(uri, null, null)
            count > 0
        } catch (e: Exception) {
            false
        }
    }
}
