package com.opennib.mobile.keyboard

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import com.opennib.mobile.MainActivity

/**
 * Tiny foreground service whose only job is to keep the opennib app process
 * alive while the keyboard is shown. Without it, Android can kill the host
 * activity (which owns the React Native context + QVAC SDK + Bare worker)
 * the moment the user switches to a third-party app, leaving the IME with
 * nowhere to send captured audio for transcription.
 *
 * The service does no work itself — it just holds a low-importance
 * notification. The IME starts it on `onStartInput` and stops it on
 * `onFinishInput`, so the notification only appears while the user is
 * actually using the keyboard.
 */
class OpennibKeepAliveService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    Log.d(TAG, "onCreate")
    ensureChannel()
    val notif = buildNotification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(
        NOTIFICATION_ID,
        notif,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
      )
    } else {
      startForeground(NOTIFICATION_ID, notif)
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

  override fun onDestroy() {
    Log.d(TAG, "onDestroy")
    super.onDestroy()
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (nm.getNotificationChannel(CHANNEL_ID) != null) return
    val channel = NotificationChannel(
      CHANNEL_ID,
      "opennib voice typing",
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = "Keeps opennib alive while the keyboard is active so dictation works without leaving your current app."
      setShowBadge(false)
    }
    nm.createNotificationChannel(channel)
  }

  private fun buildNotification(): Notification {
    val openIntent = Intent(this, MainActivity::class.java).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
      data = Uri.parse("opennib://record")
    }
    val pi = PendingIntent.getActivity(
      this,
      0,
      openIntent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("opennib voice typing")
      .setContentText("Active — your keyboard can dictate.")
      .setSmallIcon(android.R.drawable.ic_btn_speak_now)
      .setOngoing(true)
      .setShowWhen(false)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setContentIntent(pi)
      .build()
  }

  companion object {
    private const val TAG = "OpennibKeepAlive"
    private const val CHANNEL_ID = "opennib-voice-typing"
    private const val NOTIFICATION_ID = 1042

    fun start(context: Context) {
      val intent = Intent(context, OpennibKeepAliveService::class.java)
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          context.startForegroundService(intent)
        } else {
          context.startService(intent)
        }
      } catch (e: Throwable) {
        Log.w(TAG, "start failed", e)
      }
    }

    fun stop(context: Context) {
      try {
        context.stopService(Intent(context, OpennibKeepAliveService::class.java))
      } catch (e: Throwable) {
        Log.w(TAG, "stop failed", e)
      }
    }
  }
}
