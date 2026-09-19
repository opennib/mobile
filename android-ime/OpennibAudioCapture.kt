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
    rec.startRecording()
    recorder = rec
    val buf = ByteArray(bufferSize)
    thread = Thread {
      try {
        while (!stopRequested) {
          val n = rec.read(buf, 0, buf.size)
          if (n > 0) {
            synchronized(samples) { samples.write(buf, 0, n) }
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
    private const val CHANNELS = 1
    private const val BITS_PER_SAMPLE = 16
    private const val CHANNEL = AudioFormat.CHANNEL_IN_MONO
    private const val ENCODING = AudioFormat.ENCODING_PCM_16BIT
  }
}
