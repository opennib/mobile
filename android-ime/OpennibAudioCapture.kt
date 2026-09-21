package com.opennib.mobile.keyboard

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Log
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Captures 16 kHz mono 16-bit PCM via Android `AudioRecord` and writes a
 * standalone WAV file when stopped. Designed to be called from
 * `OpennibInputMethodService` so the IME owns the mic — Android grants IMEs
 * mic access without requiring the host app to be foregrounded, which is the
 * whole point of this class. expo-av on the React Native side cannot do this
 * because it routes through `MediaRecorder` from the host activity, and
 * Android pulls the activity to the foreground every time mic is requested.
 *
 * Output format matches what `@qvac/sdk`'s whisper plugin expects (the same
 * format the app produces via expo-av), so the JS side
 * can hand the WAV path straight to `transcribe({ audioChunk: <path> })`.
 */
class OpennibAudioCapture(private val cacheDir: File) {
  private var recorder: AudioRecord? = null
  private var thread: Thread? = null
  @Volatile private var stopRequested = false
  private var samples = ByteArrayOutputStream()

  /**
   * Mic level of the most recent buffer, 0..1 (RMS of 16-bit samples against
   * a -30 dBFS ceiling so normal speech reaches full scale). Drives the IME's
   * live waveform; read from the UI thread, written by the capture thread.
   */
  @Volatile var level: Float = 0f
    private set
  private var gateOpen = false
  private var gateHold = 0

  /** Throws if mic permission is missing or the device cannot open AudioRecord. */
  fun start() {
    val bufferSize = AudioRecord.getMinBufferSize(SAMPLE_RATE, CHANNEL, ENCODING)
    if (bufferSize == AudioRecord.ERROR || bufferSize == AudioRecord.ERROR_BAD_VALUE) {
      throw IllegalStateException("AudioRecord.getMinBufferSize failed: $bufferSize")
    }
    val rec = AudioRecord(MediaRecorder.AudioSource.MIC, SAMPLE_RATE, CHANNEL, ENCODING, bufferSize * 2)
    if (rec.state != AudioRecord.STATE_INITIALIZED) {
      try { rec.release() } catch (_: Throwable) {}
      throw IllegalStateException("AudioRecord state=${rec.state} (not initialized)")
    }
    samples = ByteArrayOutputStream()
    stopRequested = false
    gateOpen = false
    gateHold = 0
    level = 0f
    rec.startRecording()
    recorder = rec
    val buf = ByteArray(bufferSize)
    thread = Thread {
      try {
        while (!stopRequested) {
          val n = rec.read(buf, 0, buf.size)
          if (n > 0) {
            synchronized(samples) { samples.write(buf, 0, n) }
            level = rmsLevel(buf, n)
          } else if (n < 0) {
            Log.w(TAG, "AudioRecord.read returned $n; ending capture")
            break
          }
        }
      } catch (e: Throwable) {
        Log.w(TAG, "capture thread error", e)
      }
    }.apply { name = "opennib-capture"; start() }
  }

  /**
   * Stops the recording, joins the capture thread, releases the AudioRecord,
   * and writes a WAV file to cache. Returns the absolute path. Returns null
   * if no PCM data was captured (release happened too fast).
   */
  fun stopAndWriteWav(): String? {
    stopRequested = true
    level = 0f
    val t = thread
    thread = null
    if (t != null) {
      try { t.join(800) } catch (_: InterruptedException) {}
    }
    val rec = recorder
    recorder = null
    if (rec != null) {
      try {
        if (rec.recordingState == AudioRecord.RECORDSTATE_RECORDING) rec.stop()
      } catch (e: Throwable) {
        Log.w(TAG, "AudioRecord.stop threw", e)
      }
      try { rec.release() } catch (_: Throwable) {}
    }
    val pcm: ByteArray
    synchronized(samples) {
      pcm = samples.toByteArray()
      samples.reset()
    }
    if (pcm.isEmpty()) return null
    val file = File(cacheDir, "opennib-${System.currentTimeMillis()}.wav")
    writeWav(file, pcm)
    return file.absolutePath
  }

  /**
   * Mic level with the same hysteresis noise gate the desktop recorder uses:
   * opens at 0.006 RMS, closes below 0.003 after a short hold. Below the gate
   * the level is exactly 0, so the waveform lies flat between words instead
   * of twitching on room noise. Above it, -45..-20 dBFS maps to 0..1.
   */
  private fun rmsLevel(buf: ByteArray, n: Int): Float {
    var sum = 0.0
    var i = 0
    val count = n / 2
    while (i + 1 < n) {
      val s = ((buf[i + 1].toInt() shl 8) or (buf[i].toInt() and 0xFF)).toShort().toInt() / 32768.0
      sum += s * s
      i += 2
    }
    if (count == 0) return 0f
    val rms = Math.sqrt(sum / count)
    if (gateOpen) {
      if (rms < GATE_CLOSE_RMS) {
        if (++gateHold > GATE_HOLD_BUFFERS) { gateOpen = false; gateHold = 0 }
      } else gateHold = 0
    } else if (rms >= GATE_OPEN_RMS) {
      gateOpen = true; gateHold = 0
    }
    if (!gateOpen) return 0f
    val db = 20 * Math.log10(rms.coerceAtLeast(1e-6))
    return (((db + 45.0) / 25.0).coerceIn(0.0, 1.0)).toFloat()
  }

  private fun writeWav(file: File, pcm: ByteArray) {
    val byteRate = SAMPLE_RATE * CHANNELS * BITS_PER_SAMPLE / 8
    val blockAlign = CHANNELS * BITS_PER_SAMPLE / 8
    val dataSize = pcm.size
    val totalSize = 36 + dataSize
    val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
    header.put("RIFF".toByteArray(Charsets.US_ASCII))
    header.putInt(totalSize)
    header.put("WAVE".toByteArray(Charsets.US_ASCII))
    header.put("fmt ".toByteArray(Charsets.US_ASCII))
    header.putInt(16)
    header.putShort(1.toShort())
    header.putShort(CHANNELS.toShort())
    header.putInt(SAMPLE_RATE)
    header.putInt(byteRate)
    header.putShort(blockAlign.toShort())
    header.putShort(BITS_PER_SAMPLE.toShort())
    header.put("data".toByteArray(Charsets.US_ASCII))
    header.putInt(dataSize)
    file.outputStream().use { os ->
      os.write(header.array())
      os.write(pcm)
    }
  }

  companion object {
    private const val TAG = "OpennibCapture"
    private const val SAMPLE_RATE = 16_000
    private const val GATE_OPEN_RMS = 0.006
    private const val GATE_CLOSE_RMS = 0.003
    private const val GATE_HOLD_BUFFERS = 4
    private const val CHANNELS = 1
    private const val BITS_PER_SAMPLE = 16
    private const val CHANNEL = AudioFormat.CHANNEL_IN_MONO
    private const val ENCODING = AudioFormat.ENCODING_PCM_16BIT
  }
}
