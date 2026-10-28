package expo.modules.unfurlsurfaces

import org.json.JSONArray
import org.json.JSONObject

/** The live state right after a notification tap, before the app has run
 * (the same rules as LiveState.applying in UnfurlShared.swift). The app
 * recomputes and replaces it once it applies the queued action. Null means
 * the activity ends. */
object LiveTransitions {
  private fun controls(s: JSONObject): MutableList<String> {
    val a = s.optJSONArray("controls") ?: JSONArray()
    return MutableList(a.length()) { a.getString(it) }
  }

  private fun setControls(s: JSONObject, list: List<String>) {
    s.put("controls", JSONArray(list))
  }

  private fun swap(s: JSONObject, from: String, to: String) {
    setControls(s, controls(s).map { if (it == from) to else it })
  }

  private fun takeNext(s: JSONObject): JSONObject? {
    val next = s.optJSONArray("next") ?: return null
    if (next.length() == 0) return null
    val first = next.getJSONObject(0)
    val rest = JSONArray()
    for (i in 1 until next.length()) rest.put(next.get(i))
    s.put("next", rest)
    return first
  }

  fun apply(state: JSONObject, type: String, now: Long = System.currentTimeMillis()): JSONObject? {
    val s = JSONObject(state.toString())
    when (type) {
      "done", "skip" -> {
        val n = takeNext(s) ?: return null
        s.put("step", n.optString("label"))
          .put("detail", n.optString("detail"))
          .put("key", n.optString("key"))
          .put("index", s.optInt("index") + 1)
          .put("paused", false)
        s.remove("remainingSec")
        if (n.has("sec")) s.put("stepEndsAt", now + (n.optDouble("sec") * 1000).toLong()) else s.remove("stepEndsAt")
        swap(s, "resume", "pause")
      }
      "pause" -> {
        if (s.optBoolean("paused")) return s
        s.put("paused", true)
        s.put("elapsedSec", maxOf(0.0, (now - s.optDouble("startedAt")) / 1000))
        if (s.has("stepEndsAt")) s.put("remainingSec", maxOf(0.0, (s.optDouble("stepEndsAt") - now) / 1000))
        s.remove("stepEndsAt")
        swap(s, "pause", "resume")
      }
      "resume" -> {
        if (!s.optBoolean("paused")) return s
        s.put("paused", false)
        if (s.has("remainingSec")) s.put("stepEndsAt", now + (s.optDouble("remainingSec") * 1000).toLong())
        s.remove("remainingSec")
        if (s.optString("kind") == "timer") s.put("startedAt", now - (s.optDouble("elapsedSec") * 1000).toLong())
        swap(s, "resume", "pause")
      }
      "finishSet" -> {
        s.put("index", minOf(s.optInt("count"), s.optInt("index") + 1))
        val n = takeNext(s)
        if (n == null) {
          s.put("step", "All sets done").put("detail", "Finish when you're ready").put("key", "")
        } else {
          s.put("step", n.optString("label")).put("detail", n.optString("detail")).put("key", n.optString("key"))
        }
        val rest = s.optDouble("restSec", 0.0)
        if (rest > 0) s.put("restEndsAt", now + (rest * 1000).toLong())
        setControls(s, workoutControls(s))
      }
      "skipRest" -> {
        s.remove("restEndsAt")
        setControls(s, workoutControls(s))
      }
      "addRest" -> if (s.has("restEndsAt")) s.put("restEndsAt", s.optLong("restEndsAt") + 15_000)
      // Never past now: the app clamps the same way once it applies the tap.
      "subRest" -> if (s.has("restEndsAt")) s.put("restEndsAt", maxOf(now, s.optLong("restEndsAt") - 15_000))
      "finish" -> return null
    }
    return s
  }

  /** Resting: the in-app rest controls; otherwise the next set and finish. */
  private fun workoutControls(s: JSONObject): List<String> =
    if (s.has("restEndsAt")) listOf("subRest", "addRest", "skipRest", "finish")
    else (if (s.optString("key").isNotEmpty()) listOf("finishSet") else emptyList()) + "finish"
}
