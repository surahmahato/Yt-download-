package com.example.data.security

import android.content.Context
import android.net.Uri
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.InetAddress
import java.net.URL
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

object CryptoManager {
    private const val MAGIC_HEADER = "YTS1"
    private const val ITERATIONS = 10000
    private const val KEY_LENGTH_BITS = 256
    private const val GCM_TAG_LENGTH_BITS = 128
    private const val SALT_LENGTH_BYTES = 16
    private const val IV_LENGTH_BYTES = 12

    private const val PREFS_NAME = "yt_secure_prefs"
    private const val KEY_PIN_HASH = "vault_pin_hash"
    private const val KEY_PIN_SALT = "vault_pin_salt"
    private const val KEY_SCREEN_SHIELD = "screen_shield_active"

    private val secureRandom = SecureRandom()

    /**
     * Derives an AES-256 key from a PIN using PBKDF2 with SHA-256
     */
    private fun deriveKey(pin: String, salt: ByteArray): SecretKey {
        val spec = PBEKeySpec(pin.toCharArray(), salt, ITERATIONS, KEY_LENGTH_BITS)
        val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        val secretBytes = factory.generateSecret(spec).encoded
        return SecretKeySpec(secretBytes, "AES")
    }

    /**
     * Encrypts a media file using AES-256-GCM.
     * Header layout:
     * [4 bytes "YTS1"] [16 bytes Salt] [12 bytes IV] [Ciphertext + Auth Tag]
     */
    suspend fun encryptFile(inputFile: File, outputFile: File, pin: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val salt = ByteArray(SALT_LENGTH_BYTES).apply { secureRandom.nextBytes(this) }
            val iv = ByteArray(IV_LENGTH_BYTES).apply { secureRandom.nextBytes(this) }

            val secretKey = deriveKey(pin, salt)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, secretKey, GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv))

            FileOutputStream(outputFile).use { fos ->
                fos.write(MAGIC_HEADER.toByteArray(Charsets.UTF_8))
                fos.write(salt)
                fos.write(iv)

                FileInputStream(inputFile).use { fis ->
                    val buffer = ByteArray(64 * 1024)
                    var bytesRead: Int
                    while (fis.read(buffer).also { bytesRead = it } != -1) {
                        val outputBytes = cipher.update(buffer, 0, bytesRead)
                        if (outputBytes != null && outputBytes.isNotEmpty()) {
                            fos.write(outputBytes)
                        }
                    }
                    val finalBytes = cipher.doFinal()
                    if (finalBytes != null && finalBytes.isNotEmpty()) {
                        fos.write(finalBytes)
                    }
                }
            }
            true
        } catch (e: Exception) {
            e.printStackTrace()
            outputFile.delete()
            false
        }
    }

    /**
     * Decrypts an encrypted file using AES-256-GCM back to a plain playable file.
     */
    suspend fun decryptFile(inputFile: File, outputFile: File, pin: String): Boolean = withContext(Dispatchers.IO) {
        try {
            FileInputStream(inputFile).use { fis ->
                val magic = ByteArray(4)
                if (fis.read(magic) != 4 || String(magic, Charsets.UTF_8) != MAGIC_HEADER) {
                    return@withContext false
                }

                val salt = ByteArray(SALT_LENGTH_BYTES)
                if (fis.read(salt) != SALT_LENGTH_BYTES) return@withContext false

                val iv = ByteArray(IV_LENGTH_BYTES)
                if (fis.read(iv) != IV_LENGTH_BYTES) return@withContext false

                val secretKey = deriveKey(pin, salt)
                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(Cipher.DECRYPT_MODE, secretKey, GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv))

                FileOutputStream(outputFile).use { fos ->
                    val buffer = ByteArray(64 * 1024)
                    var bytesRead: Int
                    while (fis.read(buffer).also { bytesRead = it } != -1) {
                        val outputBytes = cipher.update(buffer, 0, bytesRead)
                        if (outputBytes != null && outputBytes.isNotEmpty()) {
                            fos.write(outputBytes)
                        }
                    }
                    val finalBytes = cipher.doFinal()
                    if (finalBytes != null && finalBytes.isNotEmpty()) {
                        fos.write(finalBytes)
                    }
                }
            }
            true
        } catch (e: Exception) {
            e.printStackTrace()
            outputFile.delete()
            false
        }
    }

    /**
     * Checks if a PIN has been set up for the Vault.
     */
    fun isVaultPinSet(context: Context): Boolean {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.contains(KEY_PIN_HASH)
    }

    /**
     * Sets or updates the vault PIN.
     */
    fun setVaultPin(context: Context, pin: String) {
        val salt = ByteArray(SALT_LENGTH_BYTES).apply { secureRandom.nextBytes(this) }
        val secretKey = deriveKey(pin, salt)
        val hash = Base64.encodeToString(secretKey.encoded, Base64.NO_WRAP)
        val saltStr = Base64.encodeToString(salt, Base64.NO_WRAP)

        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_PIN_HASH, hash)
            .putString(KEY_PIN_SALT, saltStr)
            .apply()
    }

    /**
     * Verifies the input PIN against the stored hash.
     */
    fun verifyVaultPin(context: Context, pin: String): Boolean {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val storedHash = prefs.getString(KEY_PIN_HASH, null) ?: return false
        val storedSaltStr = prefs.getString(KEY_PIN_SALT, null) ?: return false
        val salt = Base64.decode(storedSaltStr, Base64.NO_WRAP)

        val secretKey = deriveKey(pin, salt)
        val inputHash = Base64.encodeToString(secretKey.encoded, Base64.NO_WRAP)
        return storedHash == inputHash
    }

    /**
     * Screen shield (anti-screenshot & anti-screen recorder) preference
     */
    fun isScreenShieldEnabled(context: Context): Boolean {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getBoolean(KEY_SCREEN_SHIELD, true) // Enabled by default for high privacy
    }

    fun setScreenShieldEnabled(context: Context, enabled: Boolean) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(KEY_SCREEN_SHIELD, enabled)
            .apply()
    }

    /**
     * URL Security Sanitizer to prevent SSRF and injection attacks.
     */
    data class UrlValidationResult(
        val isValid: Boolean,
        val sanitizedUrl: String = "",
        val platform: String = "Direct",
        val errorReason: String? = null
    )

    fun validateAndSanitizeUrl(rawUrl: String): UrlValidationResult {
        val trimmed = rawUrl.trim()
        if (trimmed.isEmpty()) {
            return UrlValidationResult(false, errorReason = "URL cannot be empty")
        }

        // Scheme verification: strictly HTTP or HTTPS
        val lower = trimmed.lowercase()
        if (!lower.startsWith("https://") && !lower.startsWith("http://")) {
            return UrlValidationResult(false, errorReason = "Security violation: Only HTTPS or HTTP protocols are permitted.")
        }

        // Check for disallowed protocol injection
        val dangerousSchemes = listOf("file:", "javascript:", "data:", "content:", "intent:", "ftp:", "jar:")
        for (scheme in dangerousSchemes) {
            if (lower.contains(scheme)) {
                return UrlValidationResult(false, errorReason = "Attack prevention: Disallowed scheme '$scheme' detected.")
            }
        }

        try {
            val parsed = URL(trimmed)
            val host = parsed.host?.lowercase() ?: return UrlValidationResult(false, errorReason = "Invalid hostname in URL")

            // Anti-SSRF / Internal Loopback protection
            if (host == "localhost" || host == "127.0.0.1" || host == "0.0.0.0" || host == "::1") {
                return UrlValidationResult(false, errorReason = "Blocked loopback address (Anti-SSRF Protection).")
            }

            if (host.startsWith("10.") ||
                host.startsWith("192.168.") ||
                (host.startsWith("172.") && host.split(".").getOrNull(1)?.toIntOrNull() in 16..31) ||
                host.endsWith(".local") || host.endsWith(".internal")
            ) {
                return UrlValidationResult(false, errorReason = "Blocked private network address (Anti-SSRF Protection).")
            }

            // Detect Platform
            val platform = when {
                host.contains("youtube.com") || host.contains("youtu.be") -> "YouTube"
                host.contains("tiktok.com") -> "TikTok"
                host.contains("instagram.com") -> "Instagram"
                host.contains("twitter.com") || host.contains("x.com") -> "Twitter/X"
                host.contains("facebook.com") || host.contains("fb.watch") -> "Facebook"
                host.contains("reddit.com") || host.contains("redd.it") -> "Reddit"
                host.contains("vimeo.com") -> "Vimeo"
                else -> "Direct Link"
            }

            return UrlValidationResult(true, sanitizedUrl = trimmed, platform = platform)
        } catch (e: Exception) {
            return UrlValidationResult(false, errorReason = "Malformed URL: ${e.localizedMessage}")
        }
    }
}
