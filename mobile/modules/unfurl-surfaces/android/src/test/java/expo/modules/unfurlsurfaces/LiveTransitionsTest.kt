package expo.modules.unfurlsurfaces

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// The notification moves on the moment a button is tapped, before the app
// has applied the tap; these are the rules it follows (the same as the iOS
// Live Activity's), and which buttons fit.
class LiveTransitionsTest {
  private val now = 1_800_000_000_000L

  private fun routine() = JSONObject(
    """
    {"kind":"routine","id":"run1","title":"Morning","icon":"🌅","step":"🚶 Walk","detail":"Step 1 of 3 · 10 min",
     "key":"0","index":0,"count":3,"paused":false,"startedAt":${now - 60_000},"elapsedSec":60,
     "stepEndsAt":${now + 540_000},"restSec":0,
     "next":[{"key":"1","label":"📖 Read","detail":"Step 2 of 3 · 5 min","sec":300},
             {"key":"2","label":"🧘 Stretch","detail":"Step 3 of 3 · 5 min","sec":300}],
     "controls":["done","skip","pause"],"href":"/habits/routines/r/play"}
    """.trimIndent(),
  )

  private fun workout() = JSONObject(
    """
    {"kind":"workout","id":"w1","title":"Push","icon":"🏋️","step":"Bench press","detail":"Set 1 of 3 · 60 kg × 8",
     "key":"we1/s1","index":0,"count":3,"paused":false,"startedAt":${now - 600_000},"elapsedSec":600,"restSec":90,
     "next":[{"key":"we1/s2","label":"Bench press","detail":"Set 2 of 3 · 60 kg × 8"}],
     "controls":["finishSet","finish"],"href":"/fitness/workout"}
    """.trimIndent(),
  )

  private fun controls(s: JSONObject): List<String> {
    val a: JSONArray = s.getJSONArray("controls")
    return List(a.length()) { a.getString(it) }
  }

  @Test fun doneMovesToTheNextStepAndRestartsItsClock() {
    val s = LiveTransitions.apply(routine(), "done", now)!!
    assertEquals("📖 Read", s.getString("step"))
    assertEquals("1", s.getString("key"))
    assertEquals(1, s.getInt("index"))
    assertEquals(now + 300_000, s.getLong("stepEndsAt"))
    assertEquals(1, s.getJSONArray("next").length())
  }

  @Test fun theLastStepEndsTheActivity() {
    var s: JSONObject? = routine()
    s = LiveTransitions.apply(s!!, "skip", now)
    s = LiveTransitions.apply(s!!, "done", now)
    assertNull(LiveTransitions.apply(s!!, "done", now))
  }

  @Test fun pauseFreezesTheCountdownAndResumeContinuesIt() {
    val paused = LiveTransitions.apply(routine(), "pause", now)!!
    assertTrue(paused.getBoolean("paused"))
    assertFalse(paused.has("stepEndsAt"))
    assertEquals(540.0, paused.getDouble("remainingSec"), 0.01)
    assertEquals(listOf("done", "skip", "resume"), controls(paused))
    val later = now + 120_000
    val resumed = LiveTransitions.apply(paused, "resume", later)!!
    assertEquals(later + 540_000, resumed.getLong("stepEndsAt"))
    assertEquals(listOf("done", "skip", "pause"), controls(resumed))
    // Pausing twice changes nothing.
    assertEquals(paused.toString(), LiveTransitions.apply(paused, "pause", later).toString())
  }

  @Test fun finishingASetStartsRestAndOffersToSkipIt() {
    val s = LiveTransitions.apply(workout(), "finishSet", now)!!
    assertEquals("we1/s2", s.getString("key"))
    assertEquals(1, s.getInt("index"))
    assertEquals(now + 90_000, s.getLong("restEndsAt"))
    assertEquals(listOf("subRest", "addRest", "skipRest", "finish"), controls(s))
    assertEquals(listOf("subRest", "addRest", "skipRest"), LiveNotification.buttons(s))
    val longer = LiveTransitions.apply(s, "addRest", now)!!
    assertEquals(now + 105_000, longer.getLong("restEndsAt"))
    val shorter = LiveTransitions.apply(longer, "subRest", now)!!
    assertEquals(now + 90_000, shorter.getLong("restEndsAt"))
    // Taking time never goes past now.
    val late = now + 85_000
    assertEquals(late, LiveTransitions.apply(shorter, "subRest", late)!!.getLong("restEndsAt"))
    val skipped = LiveTransitions.apply(longer, "skipRest", now)!!
    assertFalse(skipped.has("restEndsAt"))
    assertEquals(listOf("finishSet", "finish"), controls(skipped))
  }

  @Test fun theLastSetLeavesOnlyFinish() {
    var s = LiveTransitions.apply(workout(), "finishSet", now)!!
    s = LiveTransitions.apply(s, "finishSet", now)!!
    assertEquals("All sets done", s.getString("step"))
    assertEquals("", s.getString("key"))
    assertEquals(listOf("subRest", "addRest", "skipRest", "finish"), controls(s))
    assertNull(LiveTransitions.apply(s, "finish", now))
  }

  @Test fun theInputIsNotChanged() {
    val r = routine()
    val before = r.toString()
    LiveTransitions.apply(r, "done", now)
    assertEquals(before, r.toString())
  }
}
