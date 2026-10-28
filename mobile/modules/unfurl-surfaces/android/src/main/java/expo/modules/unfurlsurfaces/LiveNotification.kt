package expo.modules.unfurlsurfaces

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject

/** The ongoing notification for the running routine, workout or habit
 * timer: Android's counterpart of the iOS Live Activity. The chronometer
 * counts on its own; buttons go to SurfaceActionReceiver. */
object LiveNotification {
  const val CHANNEL = "unfurl_live"
  const val ID = 4207

  fun show(ctx: Context, json: String?) {
    val state = json?.let { runCatching { JSONObject(it) }.getOrNull() }
    SurfaceStore.saveLive(ctx, state)
    if (state == null) cancel(ctx) else post(ctx, state)
  }

  fun cancel(ctx: Context) {
    NotificationManagerCompat.from(ctx).cancel(ID)
  }

  private fun ensureChannel(ctx: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
    if (nm.getNotificationChannel(CHANNEL) != null) return
    nm.createNotificationChannel(
      NotificationChannel(CHANNEL, "Routines and workouts", NotificationManager.IMPORTANCE_LOW).apply {
        description = "The routine, workout or timer you have running, with its controls."
        setShowBadge(false)
      },
    )
  }

  fun openIntent(ctx: Context, href: String, request: Int): PendingIntent {
    val path = if (href.startsWith("/")) href else "/$href"
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse("personalsop://$path"))
      .setPackage(ctx.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(ctx, request, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  fun actionIntent(ctx: Context, type: String, kind: String?, target: String, key: String?, request: Int): PendingIntent {
    val intent = Intent(ctx, SurfaceActionReceiver::class.java)
      .setAction("expo.modules.unfurlsurfaces.ACTION.$type")
      .putExtra("type", type)
      .putExtra("kind", kind)
      .putExtra("target", target)
      .putExtra("key", key)
    return PendingIntent.getBroadcast(ctx, request, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  private val labels = mapOf(
    "done" to "Done", "skip" to "Skip", "pause" to "Pause", "resume" to "Resume",
    "finishSet" to "Set done", "skipRest" to "Skip rest", "addRest" to "+15s", "subRest" to "−15s",
    "finish" to "Finish",
  )

  /** At most three buttons fit; while resting, "Finish" gives way. */
  fun buttons(state: JSONObject): List<String> {
    val a = state.optJSONArray("controls") ?: return emptyList()
    val list = MutableList(a.length()) { a.getString(it) }
    if (list.size > 3) list.remove("finish")
    return list.take(3)
  }

  fun post(ctx: Context, s: JSONObject) {
    ensureChannel(ctx)
    val now = System.currentTimeMillis()
    val kind = s.optString("kind")
    val paused = s.optBoolean("paused")
    val restEnds = if (s.has("restEndsAt")) s.optLong("restEndsAt") else 0L
    val stepEnds = if (s.has("stepEndsAt")) s.optLong("stepEndsAt") else 0L
    val accent = ContextCompat.getColor(ctx, R.color.unfurl_primary)
    val title = "${s.optString("icon")} ${s.optString("title")}".trim()
    val b = NotificationCompat.Builder(ctx, CHANNEL)
      .setSmallIcon(R.drawable.unfurl_stat)
      .setColor(accent)
      .setContentTitle(s.optString("step"))
      .setContentText(s.optString("detail"))
      .setSubText(
        when {
          restEnds > now -> "Rest"
          paused -> "Paused"
          else -> title
        },
      )
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setCategory(NotificationCompat.CATEGORY_PROGRESS)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setContentIntent(openIntent(ctx, s.optString("href"), 1))
    when {
      restEnds > now -> b.setUsesChronometer(true).setChronometerCountDown(true).setWhen(restEnds).setShowWhen(true)
      !paused && stepEnds > now -> b.setUsesChronometer(true).setChronometerCountDown(true).setWhen(stepEnds).setShowWhen(true)
      !paused -> b.setUsesChronometer(true).setWhen(s.optLong("startedAt")).setShowWhen(true)
      else -> b.setShowWhen(false)
    }
    val count = s.optInt("count")
    if (count > 0) b.setProgress(count, s.optInt("index"), false)
    val id = s.optString("id")
    val key = s.optString("key")
    buttons(s).forEachIndexed { i, type ->
      b.addAction(0, labels[type] ?: type, actionIntent(ctx, type, kind, id, key, 10 + i))
    }
    try {
      if (NotificationManagerCompat.from(ctx).areNotificationsEnabled())
        NotificationManagerCompat.from(ctx).notify(ID, b.build())
    } catch (_: SecurityException) {
      // Notifications not allowed: the app still has the activity in view.
    }
  }
}
