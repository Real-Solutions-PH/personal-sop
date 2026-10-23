package expo.modules.unfurlsurfaces

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.os.Build
import android.util.SizeF
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject
import java.time.Instant
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

// Home-screen widgets. Each fills a RemoteViews layout from the snapshot the
// app wrote (SurfaceStore); with no snapshot yet, or one from a day that has
// ended, it shows the same layout dimmed with sample numbers instead of an
// empty message.

abstract class UnfurlWidget : AppWidgetProvider() {
  abstract fun views(ctx: Context, snap: JSONObject, dimmed: Boolean): RemoteViews

  override fun onUpdate(ctx: Context, manager: AppWidgetManager, ids: IntArray) {
    val stored = SurfaceStore.snapshot(ctx)
    val ends = stored?.optString("dayEnds")?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }
    val dimmed = stored == null || (ends != null && ends <= System.currentTimeMillis())
    val snap = stored ?: UnfurlWidgets.sample
    for (id in ids) manager.updateAppWidget(id, views(ctx, snap, dimmed))
  }
}

object UnfurlWidgets {
  private val providers = listOf(
    TodayWidget::class.java, HabitsWidget::class.java, MacrosWidget::class.java,
    TasksWidget::class.java, MoneyWidget::class.java,
  )

  fun updateAll(ctx: Context) {
    val manager = AppWidgetManager.getInstance(ctx)
    for (p in providers) {
      val ids = manager.getAppWidgetIds(ComponentName(ctx, p))
      if (ids.isEmpty()) continue
      (p.getDeclaredConstructor().newInstance() as UnfurlWidget).onUpdate(ctx, manager, ids)
    }
  }

  /** A small and a wide layout, picked by the launcher from the widget's
   * size (Android 12+); older launchers get the wide one. */
  fun responsive(small: RemoteViews, wide: RemoteViews): RemoteViews =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      RemoteViews(mapOf(SizeF(110f, 110f) to small, SizeF(240f, 110f) to wide))
    } else {
      wide
    }

  fun frame(ctx: Context, v: RemoteViews, dimmed: Boolean, href: String): RemoteViews {
    v.setFloat(R.id.unfurl_root, "setAlpha", if (dimmed) 0.45f else 1f)
    v.setOnClickPendingIntent(R.id.unfurl_root, LiveNotification.openIntent(ctx, href, href.hashCode()))
    return v
  }

  fun whole(n: Double) = "%,d".format(n.roundToInt())
  fun pct(part: Double, whole: Double) = if (whole > 0) (min(1.0, part / whole) * 100).roundToInt() else 0

  val sample: JSONObject = JSONObject(
    """
    {"v":1,"at":"","day":"","dayEnds":"",
     "today":{"done":5,"due":9,"pct":0.56,"target":0.7,"headline":"2 to target","lifeScore":72,"streak":6},
     "habits":{"done":1,"total":4,"items":[
       {"id":"a","name":"Morning walk","icon":"🚶","streak":6,"done":true,"checkable":true},
       {"id":"b","name":"Read","icon":"📖","streak":3,"done":false,"checkable":true},
       {"id":"c","name":"Stretch","icon":"🧘","streak":12,"done":false,"checkable":true},
       {"id":"d","name":"Water","icon":"💧","streak":2,"done":false,"checkable":false}]},
     "macros":{"kcal":{"eaten":1240,"target":2200},"protein":{"eaten":82,"target":150},
       "carbs":{"eaten":140,"target":230},"fat":{"eaten":40,"target":70},"meals":2},
     "tasks":{"open":3,"overdue":1,"items":[
       {"id":"a","title":"Pay internet bill","when":"Overdue","overdue":true},
       {"id":"b","title":"Call the dentist","when":"Today 14:00","overdue":false},
       {"id":"c","title":"Groceries","when":"Tomorrow","overdue":false}]},
     "money":{"safeToday":"₱850","left":"₱12,400","spent":"₱17,600","limit":"₱30,000","pct":0.59,"daysLeft":14,"hidden":false},
     "live":null}
    """.trimIndent(),
  )
}

class TodayWidget : UnfurlWidget() {
  override fun views(ctx: Context, snap: JSONObject, dimmed: Boolean): RemoteViews {
    val t = snap.optJSONObject("today") ?: JSONObject()
    fun fill(layout: Int, wide: Boolean): RemoteViews {
      val v = RemoteViews(ctx.packageName, layout)
      val p = t.optDouble("pct", 0.0)
      v.setProgressBar(R.id.today_ring, 100, (p * 100).roundToInt(), false)
      v.setTextViewText(R.id.today_pct, "${(p * 100).roundToInt()}%")
      v.setTextViewText(R.id.today_count, "${t.optInt("done")}/${t.optInt("due")}")
      v.setTextViewText(R.id.today_headline, t.optString("headline"))
      if (wide) {
        val h = snap.optJSONObject("habits") ?: JSONObject()
        v.setTextViewText(R.id.row_habits_label, "Habits")
        v.setTextViewText(R.id.row_habits, "${h.optInt("done")}/${h.optInt("total")}")
        val m = snap.optJSONObject("macros")
        v.setTextViewText(R.id.row_kcal_label, "Calories left")
        v.setTextViewText(R.id.row_kcal, m?.optJSONObject("kcal")?.let {
          UnfurlWidgets.whole(max(0.0, it.optDouble("target") - it.optDouble("eaten")))
        } ?: "—")
        v.setTextViewText(R.id.row_tasks_label, "Tasks due")
        v.setTextViewText(R.id.row_tasks, "${snap.optJSONObject("tasks")?.optInt("open") ?: 0}")
        v.setTextViewText(R.id.row_money_label, "Safe today")
        v.setTextViewText(R.id.row_money, snap.optJSONObject("money")?.optString("safeToday") ?: "—")
        val live = snap.optJSONObject("live")
        v.setViewVisibility(R.id.today_live, if (live != null) View.VISIBLE else View.GONE)
        if (live != null) {
          v.setTextViewText(R.id.today_live, "▶ ${live.optString("title")}")
          v.setOnClickPendingIntent(R.id.today_live, LiveNotification.openIntent(ctx, live.optString("href"), 2))
        }
      }
      return UnfurlWidgets.frame(ctx, v, dimmed, "/today")
    }
    return UnfurlWidgets.responsive(fill(R.layout.unfurl_today_small, false), fill(R.layout.unfurl_today_medium, true))
  }
}

class HabitsWidget : UnfurlWidget() {
  private val rows = intArrayOf(R.id.habit_row_0, R.id.habit_row_1, R.id.habit_row_2, R.id.habit_row_3)
  private val icons = intArrayOf(R.id.habit_icon_0, R.id.habit_icon_1, R.id.habit_icon_2, R.id.habit_icon_3)
  private val names = intArrayOf(R.id.habit_name_0, R.id.habit_name_1, R.id.habit_name_2, R.id.habit_name_3)
  private val streaks = intArrayOf(R.id.habit_streak_0, R.id.habit_streak_1, R.id.habit_streak_2, R.id.habit_streak_3)
  private val checks = intArrayOf(R.id.habit_check_0, R.id.habit_check_1, R.id.habit_check_2, R.id.habit_check_3)

  override fun views(ctx: Context, snap: JSONObject, dimmed: Boolean): RemoteViews {
    val v = RemoteViews(ctx.packageName, R.layout.unfurl_habits)
    val h = snap.optJSONObject("habits") ?: JSONObject()
    val items = h.optJSONArray("items")
    val day = snap.optString("day")
    v.setTextViewText(R.id.habits_count, "${h.optInt("done")}/${h.optInt("total")}")
    v.setViewVisibility(R.id.habits_empty, if ((items?.length() ?: 0) == 0) View.VISIBLE else View.GONE)
    for (i in rows.indices) {
      val item = items?.optJSONObject(i)
      v.setViewVisibility(rows[i], if (item != null) View.VISIBLE else View.INVISIBLE)
      if (item == null) continue
      val done = item.optBoolean("done")
      val streak = item.optInt("streak")
      v.setTextViewText(icons[i], item.optString("icon"))
      v.setTextViewText(names[i], item.optString("name"))
      v.setTextColor(names[i], ctx.getColor(if (done) R.color.unfurl_muted else R.color.unfurl_text))
      v.setTextViewText(streaks[i], if (streak > 0) "🔥$streak" else "")
      v.setImageViewResource(checks[i], if (done) R.drawable.unfurl_check_on else R.drawable.unfurl_check_off)
      val id = item.optString("id")
      val tap = if (!done && item.optBoolean("checkable") && !dimmed) {
        LiveNotification.actionIntent(ctx, "checkHabit", null, id, day, 100 + i)
      } else {
        LiveNotification.openIntent(ctx, "/habits/$id", 200 + i)
      }
      v.setOnClickPendingIntent(checks[i], tap)
    }
    return UnfurlWidgets.frame(ctx, v, dimmed, "/habits")
  }
}

class MacrosWidget : UnfurlWidget() {
  override fun views(ctx: Context, snap: JSONObject, dimmed: Boolean): RemoteViews {
    val m = snap.optJSONObject("macros") ?: UnfurlWidgets.sample.getJSONObject("macros")
    val off = dimmed || !snap.has("macros") || snap.isNull("macros")
    fun bar(v: RemoteViews, label: Int, value: Int, barId: Int, name: String, key: String) {
      val x = m.optJSONObject(key) ?: JSONObject()
      val eaten = x.optDouble("eaten")
      val target = x.optDouble("target")
      v.setTextViewText(label, name)
      v.setTextViewText(value, "${UnfurlWidgets.whole(max(0.0, target - eaten))} g left")
      v.setProgressBar(barId, 100, UnfurlWidgets.pct(eaten, target), false)
    }
    fun fill(layout: Int, wide: Boolean): RemoteViews {
      val v = RemoteViews(ctx.packageName, layout)
      val k = m.optJSONObject("kcal") ?: JSONObject()
      v.setProgressBar(R.id.kcal_ring, 100, UnfurlWidgets.pct(k.optDouble("eaten"), k.optDouble("target")), false)
      v.setTextViewText(R.id.kcal_left, UnfurlWidgets.whole(max(0.0, k.optDouble("target") - k.optDouble("eaten"))))
      v.setTextViewText(R.id.kcal_unit, "kcal left")
      bar(v, R.id.protein_label, R.id.protein, R.id.protein_bar, "Protein", "protein")
      if (wide) {
        bar(v, R.id.carbs_label, R.id.carbs, R.id.carbs_bar, "Carbs", "carbs")
        bar(v, R.id.fat_label, R.id.fat, R.id.fat_bar, "Fat", "fat")
      }
      return UnfurlWidgets.frame(ctx, v, off, "/fitness/nutrition")
    }
    return UnfurlWidgets.responsive(fill(R.layout.unfurl_macros_small, false), fill(R.layout.unfurl_macros_medium, true))
  }
}

class TasksWidget : UnfurlWidget() {
  private val rows = intArrayOf(R.id.task_row_0, R.id.task_row_1, R.id.task_row_2, R.id.task_row_3)
  private val titles = intArrayOf(R.id.task_title_0, R.id.task_title_1, R.id.task_title_2, R.id.task_title_3)
  private val whens = intArrayOf(R.id.task_when_0, R.id.task_when_1, R.id.task_when_2, R.id.task_when_3)

  override fun views(ctx: Context, snap: JSONObject, dimmed: Boolean): RemoteViews {
    val v = RemoteViews(ctx.packageName, R.layout.unfurl_tasks)
    val t = snap.optJSONObject("tasks") ?: JSONObject()
    val items = t.optJSONArray("items")
    val overdue = t.optInt("overdue")
    v.setTextViewText(R.id.tasks_overdue, if (overdue > 0) "$overdue overdue" else "")
    v.setViewVisibility(R.id.tasks_empty, if ((items?.length() ?: 0) == 0) View.VISIBLE else View.GONE)
    for (i in rows.indices) {
      val item = items?.optJSONObject(i)
      v.setViewVisibility(rows[i], if (item != null) View.VISIBLE else View.INVISIBLE)
      if (item == null) continue
      v.setTextViewText(titles[i], item.optString("title"))
      v.setTextViewText(whens[i], item.optString("when"))
      v.setTextColor(whens[i], ctx.getColor(if (item.optBoolean("overdue")) R.color.unfurl_warn else R.color.unfurl_muted))
      v.setOnClickPendingIntent(rows[i], LiveNotification.openIntent(ctx, "/tasks/task/${item.optString("id")}", 300 + i))
    }
    return UnfurlWidgets.frame(ctx, v, dimmed, "/plan")
  }
}

class MoneyWidget : UnfurlWidget() {
  override fun views(ctx: Context, snap: JSONObject, dimmed: Boolean): RemoteViews {
    val m = snap.optJSONObject("money") ?: UnfurlWidgets.sample.getJSONObject("money")
    val off = dimmed || !snap.has("money") || snap.isNull("money")
    val v = RemoteViews(ctx.packageName, R.layout.unfurl_money)
    v.setTextViewText(R.id.money_safe, m.optString("safeToday"))
    v.setTextViewText(R.id.money_left, "${m.optString("left")} left")
    v.setTextViewText(R.id.money_days, "${m.optDouble("daysLeft").roundToInt()}d")
    v.setProgressBar(R.id.money_bar, 100, (m.optDouble("pct") * 100).roundToInt(), false)
    return UnfurlWidgets.frame(ctx, v, off, "/finance")
  }
}
