package com.example

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class ExampleRobolectricTest {

  @Test
  fun `read string from context`() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val appName = context.getString(R.string.app_name)
    assertEquals("YT Download", appName)
  }

  @Test
  fun `verify url analyzer identifies youtube url`() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val manager = com.example.data.network.VideoDownloadManager(context)
    val metadata = manager.analyzeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    org.junit.Assert.assertNotNull(metadata)
    assertEquals("YouTube", metadata?.platform)
  }
}
