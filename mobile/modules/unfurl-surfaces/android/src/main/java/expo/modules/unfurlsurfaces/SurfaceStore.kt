package expo.modules.unfurlsurfaces

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/** The widget snapshot, the live state and the queue of taps, kept in the
 * app's SharedPreferences so widgets, the receiver and JS all see them. */
object SurfaceStore {
  private const val PREFS = "unfurl_surfaces"
  private const val MAX_QUEUED = 200

  private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  /** An empty string removes it (signed out). */
  fun saveSnapshot(ctx: Context, json: String) {
    prefs(ctx).edit().apply { if (json.isEmpty()) remove("snapshot") else putString("snapshot", json) }.apply()
  }

  fun snapshot(ctx: Context): JSONObject? =
    prefs(ctx).getString("snapshot", null)?.let { runCatching { JSONObject(it) }.getOrNull() }

  fun live(ctx: Context): JSONObject? =
    prefs(ctx).getString("live", null)?.let { runCatching { JSONObject(it) }.getOrNull() }

  fun saveLive(ctx: Context, state: JSONObject?) {
    prefs(ctx).edit().apply { if (state == null) remove("live") else putString("live", state.toString()) }.apply()
  }

  @Synchronized
  fun enqueue(ctx: Context, type: String, kind: String?, target: String, key: String?, at: Long = System.currentTimeMillis()) {
    val list = runCatching { JSONArray(prefs(ctx).getString("actions", "[]")) }.getOrDefault(JSONArray())
    val a = JSONObject()
      .put("id", UUID.randomUUID().toString())
      .put("type", type)
      .put("target", target)
      .put("at", at)
    if (!kind.isNullOrEmpty()) a.put("kind", kind)
    if (!key.isNullOrEmpty()) a.put("key", key)
    list.put(a)
    val kept = JSONArray()
    val from = maxOf(0, list.length() - MAX_QUEUED)
    for (i in from until list.length()) kept.put(list.get(i))
    prefs(ctx).edit().putString("actions", kept.toString()).commit()
  }

  @Synchronized
  fun drain(ctx: Context): String {
    val p = prefs(ctx)
    val out = p.getString("actions", "[]") ?: "[]"
    p.edit().putString("actions", "[]").commit()
    return out
  }

  /** Ticks a habit in the stored snapshot so the widget shows it at once. */
  fun markHabitDone(ctx: Context, habitId: String, day: String?) {
    val snap = snapshot(ctx) ?: return
    if (day != null && snap.optString("day") != day) return
    val habits = snap.optJSONObject("habits") ?: return
    val items = habits.optJSONArray("items") ?: return
    for (i in 0 until items.length()) {
      val item = items.optJSONObject(i) ?: continue
      if (item.optString("id") == habitId && !item.optBoolean("done")) {
        item.put("done", true).put("streak", item.optInt("streak") + 1)
        habits.put("done", habits.optInt("done") + 1)
        saveSnapshot(ctx, snap.toString())
        return
      }
    }
  }
}
