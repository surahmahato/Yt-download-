package com.example.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// Color Palette specifically tailored for user request:
// Red & Blue branding with light pink background
private val LightPinkBgTop = Color(0xFFFFF5F8)
private val LightPinkBgCenter = Color(0xFFFDE8EF)
private val LightPinkBgBottom = Color(0xFFFCE4EC)

private val BrandRed = Color(0xFFDC2626)       // Vibrant YouTube Red
private val BrandRedAccent = Color(0xFFEF4444) // Bright Red Accent
private val BrandBlue = Color(0xFF1D4ED8)      // Royal Electric Blue
private val BrandBlueAccent = Color(0xFF3B82F6)// Bright Blue Accent

@Composable
fun LaunchAnimationScreen(
    onAnimationFinished: () -> Unit,
    modifier: Modifier = Modifier
) {
    // Animation States
    val logoScale = remember { Animatable(0.2f) }
    val logoAlpha = remember { Animatable(0f) }
    val titleScale = remember { Animatable(0.6f) }
    val titleAlpha = remember { Animatable(0f) }
    val progress = remember { Animatable(0f) }
    val exitAlpha = remember { Animatable(1f) }

    var isArrowDown by remember { mutableStateOf(false) }

    // Pulsing Rings Transition (Infinite)
    val infiniteTransition = rememberInfiniteTransition(label = "pulse_rings")
    val pulseRedScale by infiniteTransition.animateFloat(
        initialValue = 0.9f,
        targetValue = 1.45f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 1400, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "pulse_red_scale"
    )
    val pulseRedAlpha by infiniteTransition.animateFloat(
        initialValue = 0.55f,
        targetValue = 0.0f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 1400, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "pulse_red_alpha"
    )

    val pulseBlueScale by infiniteTransition.animateFloat(
        initialValue = 0.9f,
        targetValue = 1.6f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 1600, delayMillis = 300, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "pulse_blue_scale"
    )
    val pulseBlueAlpha by infiniteTransition.animateFloat(
        initialValue = 0.5f,
        targetValue = 0.0f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 1600, delayMillis = 300, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "pulse_blue_alpha"
    )

    // Sequence coordinator
    LaunchedEffect(Unit) {
        // 1. Pop logo in with spring
        launch {
            logoAlpha.animateTo(1f, animationSpec = tween(350))
        }
        launch {
            logoScale.animateTo(
                targetValue = 1f,
                animationSpec = spring(
                    dampingRatio = 0.55f,
                    stiffness = 350f
                )
            )
        }

        delay(250)
        isArrowDown = true

        // 2. Reveal title "YT Download"
        launch {
            titleAlpha.animateTo(1f, animationSpec = tween(400))
        }
        launch {
            titleScale.animateTo(
                targetValue = 1f,
                animationSpec = spring(
                    dampingRatio = 0.65f,
                    stiffness = 400f
                )
            )
        }

        // 3. Smooth dual red-blue progress bar
        launch {
            progress.animateTo(
                targetValue = 1f,
                animationSpec = tween(durationMillis = 1600, easing = FastOutSlowInEasing)
            )
        }

        // Wait for animation to finish (~2.2 seconds total duration)
        delay(2100)

        // 4. Smooth exit fade
        exitAlpha.animateTo(0f, animationSpec = tween(300))
        onAnimationFinished()
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .alpha(exitAlpha.value)
            .background(
                brush = Brush.verticalGradient(
                    colors = listOf(
                        LightPinkBgTop,
                        LightPinkBgCenter,
                        LightPinkBgBottom
                    )
                )
            )
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null
            ) {
                // Tap anywhere to skip smoothly if user wants immediate access
                onAnimationFinished()
            }
            .testTag("launch_animation_screen"),
        contentAlignment = Alignment.Center
    ) {
        // Decorative Soft Glowing Background Orbs
        Canvas(modifier = Modifier.fillMaxSize()) {
            // Soft red glow orb in top left
            drawCircle(
                color = BrandRedAccent.copy(alpha = 0.08f),
                radius = size.width * 0.45f,
                center = Offset(size.width * 0.2f, size.height * 0.25f)
            )
            // Soft blue glow orb in bottom right
            drawCircle(
                color = BrandBlueAccent.copy(alpha = 0.08f),
                radius = size.width * 0.5f,
                center = Offset(size.width * 0.8f, size.height * 0.7f)
            )
        }

        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
            modifier = Modifier.padding(horizontal = 24.dp)
        ) {
            // Central Emblem with Red & Blue Pulsing Wave Rings
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .size(170.dp)
                    .scale(logoScale.value)
                    .alpha(logoAlpha.value)
            ) {
                // Outer Pulsing Red Wave Ring
                Canvas(
                    modifier = Modifier
                        .size(120.dp)
                        .scale(pulseRedScale)
                        .alpha(pulseRedAlpha)
                ) {
                    drawCircle(
                        color = BrandRedAccent,
                        style = Stroke(width = 3.dp.toPx())
                    )
                }

                // Outer Pulsing Blue Wave Ring
                Canvas(
                    modifier = Modifier
                        .size(120.dp)
                        .scale(pulseBlueScale)
                        .alpha(pulseBlueAlpha)
                ) {
                    drawCircle(
                        color = BrandBlueAccent,
                        style = Stroke(width = 2.5.dp.toPx())
                    )
                }

                // Central Card with Dual Red-to-Blue Gradient Glow & Border
                Surface(
                    shape = RoundedCornerShape(28.dp),
                    color = Color.White,
                    shadowElevation = 14.dp,
                    modifier = Modifier
                        .size(108.dp)
                        .border(
                            width = 3.dp,
                            brush = Brush.linearGradient(
                                colors = listOf(
                                    BrandRed,
                                    BrandRedAccent,
                                    BrandBlueAccent,
                                    BrandBlue
                                )
                            ),
                            shape = RoundedCornerShape(28.dp)
                        )
                ) {
                    Box(
                        contentAlignment = Alignment.Center,
                        modifier = Modifier.fillMaxSize()
                    ) {
                        // Background gradient sheen
                        Box(
                            modifier = Modifier
                                .fillMaxSize()
                                .background(
                                    brush = Brush.radialGradient(
                                        colors = listOf(
                                            Color.White,
                                            Color(0xFFFFF0F5)
                                        )
                                    )
                                )
                        )

                        // Center Icon: Play + Download with Red & Blue dynamic colors
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.Center
                        ) {
                            // YouTube Play symbol (Red)
                            Surface(
                                shape = CircleShape,
                                color = BrandRed,
                                modifier = Modifier
                                    .size(42.dp)
                                    .shadow(6.dp, CircleShape, spotColor = BrandRed)
                            ) {
                                Box(contentAlignment = Alignment.Center) {
                                    Icon(
                                        imageVector = Icons.Default.PlayArrow,
                                        contentDescription = null,
                                        tint = Color.White,
                                        modifier = Modifier.size(26.dp)
                                    )
                                }
                            }

                            Spacer(modifier = Modifier.width(6.dp))

                            // Download Arrow (Blue)
                            Surface(
                                shape = CircleShape,
                                color = BrandBlue,
                                modifier = Modifier
                                    .size(42.dp)
                                    .shadow(6.dp, CircleShape, spotColor = BrandBlue)
                            ) {
                                Box(contentAlignment = Alignment.Center) {
                                    Icon(
                                        imageVector = Icons.Default.Download,
                                        contentDescription = null,
                                        tint = Color.White,
                                        modifier = Modifier
                                            .size(24.dp)
                                            .offset(y = if (isArrowDown) 1.5.dp else (-1.5).dp)
                                    )
                                }
                            }
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            // Animated "YT download" Title with Red & Blue Color
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.Center,
                modifier = Modifier
                    .scale(titleScale.value)
                    .alpha(titleAlpha.value)
            ) {
                // "YT" in YouTube Red Badge
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = BrandRed,
                    shadowElevation = 4.dp,
                    modifier = Modifier.padding(end = 8.dp)
                ) {
                    Text(
                        text = "YT",
                        style = MaterialTheme.typography.headlineMedium.copy(
                            fontWeight = FontWeight.Black,
                            letterSpacing = 0.5.sp
                        ),
                        color = Color.White,
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp)
                    )
                }

                // "Download" in Electric Blue
                Text(
                    text = "Download",
                    style = MaterialTheme.typography.headlineMedium.copy(
                        fontWeight = FontWeight.Black,
                        letterSpacing = (-0.5).sp
                    ),
                    color = BrandBlue
                )
            }

            Spacer(modifier = Modifier.height(8.dp))

            // Subtitle Tagline
            Text(
                text = "Fast Social Video & Audio Saver",
                style = MaterialTheme.typography.bodyMedium.copy(
                    fontWeight = FontWeight.SemiBold,
                    letterSpacing = 0.2.sp
                ),
                color = Color(0xFF831843), // Deep berry slate to match light pink aesthetic
                modifier = Modifier.alpha(titleAlpha.value)
            )

            Spacer(modifier = Modifier.height(32.dp))

            // Dual Red-to-Blue Animated Progress Bar
            Box(
                modifier = Modifier
                    .width(190.dp)
                    .height(6.dp)
                    .clip(RoundedCornerShape(50))
                    .background(Color(0xFFF3D0DC)) // Soft pink track
                    .alpha(titleAlpha.value)
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth(progress.value)
                        .height(6.dp)
                        .clip(RoundedCornerShape(50))
                        .background(
                            brush = Brush.horizontalGradient(
                                colors = listOf(
                                    BrandRed,
                                    Color(0xFF8B5CF6), // Violet blend
                                    BrandBlue
                                )
                            )
                        )
                )
            }

            Spacer(modifier = Modifier.height(14.dp))

            // Quick status pill
            Surface(
                shape = RoundedCornerShape(20.dp),
                color = Color.White.copy(alpha = 0.85f),
                shadowElevation = 2.dp,
                modifier = Modifier.alpha(titleAlpha.value)
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 5.dp)
                ) {
                    Box(
                        modifier = Modifier
                            .size(7.dp)
                            .clip(CircleShape)
                            .background(BrandRed)
                    )
                    Spacer(modifier = Modifier.width(5.dp))
                    Box(
                        modifier = Modifier
                            .size(7.dp)
                            .clip(CircleShape)
                            .background(BrandBlue)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = if (progress.value < 1f) "Starting Fast Engine..." else "Ready",
                        style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold),
                        color = Color(0xFF475569)
                    )
                }
            }
        }
    }
}
