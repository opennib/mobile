package com.opennib.mobile.keyboard

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.view.View
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin

/**
 * Live waveform after the design's `LiveWave` (recording panel A-K-2): 36
 * rounded bars in the recording colour, each on its own eased sine cycle so the
 * shape keeps moving, scaled by the mic level so silence settles to a near-flat
 * line and speech fills it. Mirrors the iOS keyboard's WaveView.
 */
class OpennibWaveView(context: Context) : View(context) {
  private val bars = 36
  private val gapPx = dp(3f)
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFFD64A2C.toInt(); alpha = 230 }
  private val rect = RectF()
  private var startNs = 0L
  private var intensity = 0f
  private var running = false

  /**
   * Target 0..1 level; eased toward on every frame so bars don't pop. Zero at
   * silence: like the desktop HUD and the iOS keyboard, the bars lie flat
   * until the mic level clears the noise gate, then breathe with the voice.
   */
  var targetLevel = 0f

  fun start() {
    startNs = System.nanoTime()
    running = true
    alpha = 1f
    postInvalidateOnAnimation()
  }

  /** Stop animating and dim — the frozen wave while transcribing. */
  fun freeze() {
    running = false
    alpha = 0.35f
    invalidate()
  }

  fun reset() {
    running = false
    intensity = 0f
    targetLevel = 0f
    alpha = 1f
    invalidate()
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    val n = bars.toFloat()
    val barW = ((width - (n - 1) * gapPx) / n).coerceAtLeast(dp(2f))
    val maxH = height.toFloat()
    // Attack fast, release slower, so a word lights the bars at once and they
    // settle rather than snap back to the baseline.
    val target = targetLevel.coerceIn(0f, 1f)
    if (running) intensity += (target - intensity) * (if (target > intensity) 0.5f else 0.15f)
    val t = (System.nanoTime() - startNs) / 1e9
    for (i in 0 until bars) {
      val fi = i.toDouble()
      // Per-bar peak, period and phase are the design's LiveWave constants;
      // the sine motion is scaled by intensity too, so silence is a still line.
      val peak = 0.35 + abs(sin(fi * 0.9) + cos(fi * 0.5)) * 0.32
      val period = 0.5 + ((i * 7) % 5) * 0.13
      val delay = ((i * 3) % 7) * 0.08
      val wobble = if (running) 0.55 + 0.45 * sin((t - delay) / period * 2 * Math.PI) else 0.55
      val h = (maxH * min(1.0, peak * wobble) * intensity).toFloat().coerceAtLeast(dp(2f))
      val x = i * (barW + gapPx)
      rect.set(x, (maxH - h) / 2, x + barW, (maxH + h) / 2)
      canvas.drawRoundRect(rect, barW / 2, barW / 2, paint)
    }
    if (running) postInvalidateOnAnimation()
  }

  private fun dp(v: Float): Float = v * context.resources.displayMetrics.density
}
