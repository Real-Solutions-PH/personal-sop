package expo.modules.unfurlsurfaces

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.facebook.react.HeadlessJsTaskService

/** A tap on the ongoing notification or a widget. It queues the action for
 * the app, moves the notification or widget on at once, and makes sure the
 * app applies it now: directly when its JS is running, otherwise through a
 * short headless JS task (UnfurlSurfacesTaskService). */
class SurfaceActionReceiver : BroadcastReceiver() {
  override fun onReceive(ctx: Context, intent: Intent) {
    val type = intent.getStringExtra("type") ?: return
    val target = intent.getStringExtra("target") ?: return
    val kind = intent.getStringExtra("kind")
    val key = intent.getStringExtra("key")
    SurfaceStore.enqueue(ctx, type, kind, target, key)
    if (type == "checkHabit") {
      SurfaceStore.markHabitDone(ctx, target, key)
      UnfurlWidgets.updateAll(ctx)
    } else {
      advanceNotification(ctx, type, target, key)
    }
    val listener = UnfurlSurfacesModule.listener
    if (listener != null) {
      listener()
      return
    }
    try {
      ctx.startService(Intent(ctx, UnfurlSurfacesTaskService::class.java))
      HeadlessJsTaskService.acquireWakeLockNow(ctx)
    } catch (_: IllegalStateException) {
      // Not allowed to start now: the app applies the queue when it opens.
    }
  }

  private fun advanceNotification(ctx: Context, type: String, target: String, key: String?) {
    val live = SurfaceStore.live(ctx) ?: return
    if (live.optString("id") != target) return
    // A second tap on a step that already moved on changes nothing.
    if (type in setOf("done", "skip", "finishSet") && !key.isNullOrEmpty() && key != live.optString("key")) return
    val next = LiveTransitions.apply(live, type)
    SurfaceStore.saveLive(ctx, next)
    if (next == null) LiveNotification.cancel(ctx) else LiveNotification.post(ctx, next)
  }
}
