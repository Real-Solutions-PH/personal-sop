// Home-screen and lock-screen widgets. Each reads the snapshot the app wrote
// (UnfurlShared.swift); with no snapshot yet, or one from a day that has
// ended, it draws the same layout dimmed rather than an empty message.

import AppIntents
import SwiftUI
import WidgetKit

// MARK: - Theme (asset colours from docs/brand tokens, light and dark)

enum Tone {
  static let card = Color("card")
  static let text = Color("text")
  static let muted = Color("muted")
  static let soft = Color("soft")
  static let line = Color("line")
  static let primary = Color("primary")
  static let hab = Color("hab")
  static let tsk = Color("tsk")
  static let fit = Color("fit")
  static let nut = Color("nut")
  static let fin = Color("fin")
  static let life = Color("life")
  static let warn = Color("warn")
}

func deepLink(_ path: String) -> URL {
  URL(string: "personalsop://\(path.hasPrefix("/") ? path : "/" + path)")!
}

// MARK: - Timeline

struct SnapshotEntry: TimelineEntry {
  let date: Date
  let snap: WidgetSnapshot
  /** No snapshot yet, or the day it describes has ended. */
  let dimmed: Bool
}

struct SnapshotProvider: TimelineProvider {
  func placeholder(in context: Context) -> SnapshotEntry {
    SnapshotEntry(date: Date(), snap: .sample, dimmed: false)
  }
  func getSnapshot(in context: Context, completion: @escaping (SnapshotEntry) -> Void) {
    let snap = SharedStore.snapshot()
    completion(SnapshotEntry(date: Date(), snap: snap ?? .sample, dimmed: false))
  }
  func getTimeline(in context: Context, completion: @escaping (Timeline<SnapshotEntry>) -> Void) {
    let now = Date()
    guard let snap = SharedStore.snapshot() else {
      completion(Timeline(entries: [SnapshotEntry(date: now, snap: .sample, dimmed: true)], policy: .never))
      return
    }
    let ends = snap.dayEndsDate ?? now.addingTimeInterval(86_400)
    var entries = [SnapshotEntry(date: now, snap: snap, dimmed: ends <= now)]
    if ends > now { entries.append(SnapshotEntry(date: ends, snap: snap, dimmed: true)) }
    // The app reloads the timelines whenever it writes a new snapshot.
    completion(Timeline(entries: entries, policy: .never))
  }
}

extension WidgetSnapshot {
  static let sample = WidgetSnapshot(
    v: 1, at: "", day: "", dayEnds: "",
    today: .init(done: 5, due: 9, pct: 5.0 / 9, target: 0.7, headline: "2 to target", lifeScore: 72, streak: 6),
    habits: .init(done: 2, total: 5, items: [
      .init(id: "a", name: "Morning walk", icon: "🚶", streak: 6, done: true, time: "07:00", checkable: true),
      .init(id: "b", name: "Read", icon: "📖", streak: 3, done: false, time: nil, checkable: true),
      .init(id: "c", name: "Stretch", icon: "🧘", streak: 12, done: false, time: "21:00", checkable: true),
      .init(id: "d", name: "Water", icon: "💧", streak: 2, done: false, time: nil, checkable: false),
    ]),
    macros: .init(kcal: .init(eaten: 1240, target: 2200), protein: .init(eaten: 82, target: 150),
                  carbs: .init(eaten: 140, target: 230), fat: .init(eaten: 40, target: 70), meals: 2),
    tasks: .init(open: 3, overdue: 1, items: [
      .init(id: "a", title: "Pay internet bill", when: "Overdue", overdue: true),
      .init(id: "b", title: "Call the dentist", when: "Today 14:00", overdue: false),
      .init(id: "c", title: "Groceries", when: "Tomorrow", overdue: false),
    ]),
    money: .init(safeToday: "₱850", left: "₱12,400", spent: "₱17,600", limit: "₱30,000", pct: 0.59, daysLeft: 14, hidden: false),
    live: nil)
}

// MARK: - Pieces

struct RingView: View {
  var value: Double
  var color: Color
  var width: CGFloat = 6
  var body: some View {
    ZStack {
      Circle().stroke(Tone.soft, lineWidth: width)
      Circle()
        .trim(from: 0, to: max(0.001, min(1, value)))
        .stroke(color, style: StrokeStyle(lineWidth: width, lineCap: .round))
        .rotationEffect(.degrees(-90))
    }
  }
}

struct BarView: View {
  var value: Double
  var color: Color
  var height: CGFloat = 6
  var body: some View {
    GeometryReader { g in
      ZStack(alignment: .leading) {
        Capsule().fill(Tone.soft)
        Capsule().fill(color).frame(width: max(height, g.size.width * min(1, max(0, value))))
      }
    }
    .frame(height: height)
  }
}

struct Caption: View {
  var text: String
  var body: some View {
    Text(text.uppercased())
      .font(.system(size: 10, weight: .semibold))
      .tracking(0.8)
      .foregroundStyle(Tone.muted)
  }
}

/** Every widget's frame: the plain card surface, dimmed when stale. */
struct Card<Content: View>: View {
  var dimmed: Bool
  var link: String
  @ViewBuilder var content: Content
  var body: some View {
    content
      .opacity(dimmed ? 0.45 : 1)
      .overlay(alignment: .bottomTrailing) {
        if dimmed {
          Text("Open Unfurl")
            .font(.system(size: 10, weight: .medium))
            .foregroundStyle(Tone.muted)
        }
      }
      .widgetURL(deepLink(link))
      .containerBackground(for: .widget) { Tone.card }
  }
}

let mono = Font.system(.body, design: .rounded).monospacedDigit()
func whole(_ v: Double) -> String { v.formatted(.number.precision(.fractionLength(0))) }

// MARK: - Today

struct TodayView: View {
  @Environment(\.widgetFamily) var family
  var entry: SnapshotEntry
  var t: WidgetSnapshot.Today { entry.snap.today }
  var ringColor: Color { t.pct >= t.target ? Tone.life : Tone.primary }

  var body: some View {
    switch family {
    case .accessoryCircular:
      Gauge(value: t.pct) { Text("Day") } currentValueLabel: { Text("\(Int(t.pct * 100))") }
        .gaugeStyle(.accessoryCircularCapacity)
        .widgetURL(deepLink("/today"))
        .containerBackground(for: .widget) { Color.clear }
    case .accessoryRectangular:
      VStack(alignment: .leading, spacing: 2) {
        Text("Today · \(Int(t.pct * 100))%").font(.headline)
        Text(t.headline).font(.caption)
        Text("\(t.done) of \(t.due) done").font(.caption2).foregroundStyle(.secondary)
      }
      .widgetURL(deepLink("/today"))
      .containerBackground(for: .widget) { Color.clear }
    case .accessoryInline:
      Text("\(Int(t.pct * 100))% · \(t.headline)")
        .widgetURL(deepLink("/today"))
        .containerBackground(for: .widget) { Color.clear }
    case .systemMedium:
      Card(dimmed: entry.dimmed, link: "/today") {
        HStack(spacing: 14) {
          ring(size: 96)
          VStack(alignment: .leading, spacing: 6) {
            if let live = entry.snap.live {
              liveRow(live)
            }
            moduleRow("Habits", "\(entry.snap.habits.done)/\(entry.snap.habits.total)", Tone.hab)
            if let m = entry.snap.macros {
              moduleRow("Calories left", whole(m.kcal.left), Tone.nut)
            }
            moduleRow("Tasks due", "\(entry.snap.tasks.open)", Tone.tsk)
            if let money = entry.snap.money {
              moduleRow("Safe today", money.safeToday, Tone.fin)
            }
          }
        }
      }
    default:
      Card(dimmed: entry.dimmed, link: "/today") {
        VStack(alignment: .leading, spacing: 6) {
          HStack {
            Caption(text: "Today")
            Spacer()
            if let score = t.lifeScore {
              Label("\(score)", systemImage: "sparkles")
                .font(.system(size: 11, weight: .semibold)).foregroundStyle(Tone.life)
            }
          }
          ring(size: 70).frame(maxWidth: .infinity)
          Text(t.headline).font(.system(size: 13, weight: .semibold)).foregroundStyle(Tone.text).lineLimit(1)
        }
      }
    }
  }

  func ring(size: CGFloat) -> some View {
    ZStack {
      RingView(value: t.due > 0 ? t.pct : 1, color: ringColor, width: size / 10)
      VStack(spacing: 0) {
        Text("\(Int(t.pct * 100))%")
          .font(.system(size: size * 0.26, weight: .semibold, design: .rounded).monospacedDigit())
          .foregroundStyle(Tone.text)
        Text("\(t.done)/\(t.due)").font(.system(size: size * 0.13)).foregroundStyle(Tone.muted)
      }
    }
    .frame(width: size, height: size)
  }

  func moduleRow(_ label: String, _ value: String, _ color: Color) -> some View {
    HStack(spacing: 6) {
      Circle().fill(color).frame(width: 6, height: 6)
      Text(label).font(.system(size: 12)).foregroundStyle(Tone.muted).lineLimit(1)
      Spacer(minLength: 4)
      Text(value).font(.system(size: 13, weight: .semibold, design: .rounded).monospacedDigit())
        .foregroundStyle(Tone.text).lineLimit(1)
    }
  }

  func liveRow(_ live: WidgetSnapshot.Live) -> some View {
    Link(destination: deepLink(live.href)) {
      HStack(spacing: 6) {
        Image(systemName: live.kind == "workout" ? "figure.strengthtraining.traditional" : "play.circle.fill")
          .font(.system(size: 11)).foregroundStyle(live.kind == "workout" ? Tone.fit : Tone.hab)
        Text(live.title).font(.system(size: 12, weight: .medium)).foregroundStyle(Tone.text).lineLimit(1)
      }
    }
  }
}

struct TodayWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "UnfurlToday", provider: SnapshotProvider()) { TodayView(entry: $0) }
      .configurationDisplayName("Today")
      .description("Your day's progress, Life Score and what's left.")
      .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline])
  }
}

// MARK: - Habits

struct HabitsView: View {
  @Environment(\.widgetFamily) var family
  var entry: SnapshotEntry
  var h: WidgetSnapshot.Habits { entry.snap.habits }

  var body: some View {
    switch family {
    case .accessoryRectangular:
      VStack(alignment: .leading, spacing: 2) {
        Text("Habits \(h.done)/\(h.total)").font(.headline)
        ForEach(h.items.filter { !$0.done }.prefix(2), id: \.id) { item in
          Text("\(item.icon) \(item.name)").font(.caption).lineLimit(1)
        }
        if h.total > 0 && h.done >= h.total { Text("All done today").font(.caption) }
      }
      .widgetURL(deepLink("/habits"))
      .containerBackground(for: .widget) { Color.clear }
    case .accessoryCircular:
      Gauge(value: h.total > 0 ? Double(h.done) / Double(h.total) : 0) { Image(systemName: "checkmark") }
        currentValueLabel: { Text("\(h.done)") }
        .gaugeStyle(.accessoryCircularCapacity)
        .widgetURL(deepLink("/habits"))
        .containerBackground(for: .widget) { Color.clear }
    default:
      let rows = family == .systemSmall ? 3 : (family == .systemLarge ? 6 : 4)
      Card(dimmed: entry.dimmed, link: "/habits") {
        VStack(alignment: .leading, spacing: family == .systemSmall ? 6 : 5) {
          HStack {
            Caption(text: "Habits")
            Spacer()
            Text("\(h.done)/\(h.total)").font(.system(size: 12, weight: .semibold).monospacedDigit())
              .foregroundStyle(Tone.hab)
          }
          if h.items.isEmpty {
            Text("Nothing due today").font(.system(size: 13)).foregroundStyle(Tone.muted)
          }
          ForEach(h.items.prefix(rows), id: \.id) { item in
            row(item, compact: family == .systemSmall)
          }
          Spacer(minLength: 0)
        }
      }
    }
  }

  @ViewBuilder
  func row(_ item: WidgetHabit, compact: Bool) -> some View {
    HStack(spacing: 8) {
      Text(item.icon).font(.system(size: compact ? 13 : 15))
      VStack(alignment: .leading, spacing: 0) {
        Text(item.name).font(.system(size: compact ? 12 : 13, weight: .medium))
          .foregroundStyle(item.done ? Tone.muted : Tone.text).strikethrough(item.done && !compact)
          .lineLimit(1)
        if !compact, let time = item.time {
          Text(time).font(.system(size: 10)).foregroundStyle(Tone.muted)
        }
      }
      Spacer(minLength: 2)
      if item.streak > 0 {
        HStack(spacing: 1) {
          Image(systemName: "flame.fill").font(.system(size: 9))
          Text("\(item.streak)").font(.system(size: 11, weight: .semibold).monospacedDigit())
        }
        .foregroundStyle(Tone.life)
      }
      check(item)
    }
  }

  @ViewBuilder
  func check(_ item: WidgetHabit) -> some View {
    let mark = ZStack {
      Circle().stroke(item.done ? Tone.hab : Tone.line, lineWidth: 1.5)
      if item.done {
        Circle().fill(Tone.hab)
        Image(systemName: "checkmark").font(.system(size: 9, weight: .bold)).foregroundStyle(Tone.card)
      }
    }
    .frame(width: 20, height: 20)
    if item.checkable && !item.done && !entry.dimmed {
      Button(intent: CheckHabitIntent(habitId: item.id, day: entry.snap.day)) { mark }
        .buttonStyle(.plain)
    } else if !item.done {
      Link(destination: deepLink("/habits/\(item.id)")) { mark }
    } else {
      mark
    }
  }
}

struct HabitsWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "UnfurlHabits", provider: SnapshotProvider()) { HabitsView(entry: $0) }
      .configurationDisplayName("Habits")
      .description("Today's habits with their streaks. Tick one off right here.")
      .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular, .accessoryCircular])
  }
}

// MARK: - Macros

struct MacrosView: View {
  @Environment(\.widgetFamily) var family
  var entry: SnapshotEntry
  var m: WidgetSnapshot.Macros {
    entry.snap.macros ?? WidgetSnapshot.sample.macros!
  }
  var dimmed: Bool { entry.dimmed || entry.snap.macros == nil }

  var body: some View {
    switch family {
    case .accessoryCircular:
      Gauge(value: m.kcal.share) { Text("kcal") } currentValueLabel: { Text(whole(m.kcal.left)) }
        .gaugeStyle(.accessoryCircularCapacity)
        .widgetURL(deepLink("/fitness/nutrition"))
        .containerBackground(for: .widget) { Color.clear }
    case .accessoryRectangular:
      VStack(alignment: .leading, spacing: 2) {
        Text("\(whole(m.kcal.left)) kcal left").font(.headline)
        Text("Protein \(whole(m.protein.left)) g left").font(.caption)
        Gauge(value: m.kcal.share) {}.gaugeStyle(.accessoryLinearCapacity)
      }
      .widgetURL(deepLink("/fitness/nutrition"))
      .containerBackground(for: .widget) { Color.clear }
    case .systemMedium:
      Card(dimmed: dimmed, link: "/fitness/nutrition") {
        HStack(spacing: 16) {
          kcalRing(size: 92)
          VStack(alignment: .leading, spacing: 8) {
            macroBar("Protein", m.protein, Tone.nut)
            macroBar("Carbs", m.carbs, Tone.fit)
            macroBar("Fat", m.fat, Tone.life)
          }
        }
      }
    default:
      Card(dimmed: dimmed, link: "/fitness/nutrition") {
        VStack(alignment: .leading, spacing: 8) {
          Caption(text: "Left today")
          kcalRing(size: 64).frame(maxWidth: .infinity)
          macroBar("Protein", m.protein, Tone.nut)
        }
      }
    }
  }

  func kcalRing(size: CGFloat) -> some View {
    ZStack {
      RingView(value: m.kcal.share, color: m.kcal.eaten > m.kcal.target * 1.1 ? Tone.warn : Tone.nut, width: size / 10)
      VStack(spacing: 0) {
        Text(whole(m.kcal.left))
          .font(.system(size: size * 0.24, weight: .semibold, design: .rounded).monospacedDigit())
          .foregroundStyle(Tone.text).minimumScaleFactor(0.6)
        Text("kcal left").font(.system(size: size * 0.12)).foregroundStyle(Tone.muted)
      }
    }
    .frame(width: size, height: size)
  }

  func macroBar(_ label: String, _ v: WidgetMacro, _ color: Color) -> some View {
    VStack(alignment: .leading, spacing: 3) {
      HStack {
        Text(label).font(.system(size: 11)).foregroundStyle(Tone.muted)
        Spacer()
        Text("\(whole(v.left)) g left").font(.system(size: 11, weight: .semibold).monospacedDigit())
          .foregroundStyle(Tone.text)
      }
      BarView(value: v.share, color: color, height: 5)
    }
  }
}

struct MacrosWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "UnfurlMacros", provider: SnapshotProvider()) { MacrosView(entry: $0) }
      .configurationDisplayName("Macros")
      .description("Calories and protein left for today.")
      .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular])
  }
}

// MARK: - Tasks

struct TasksView: View {
  @Environment(\.widgetFamily) var family
  var entry: SnapshotEntry
  var t: WidgetSnapshot.Tasks { entry.snap.tasks }

  var body: some View {
    switch family {
    case .accessoryRectangular:
      VStack(alignment: .leading, spacing: 2) {
        Text(t.overdue > 0 ? "\(t.overdue) overdue" : "\(t.open) due today").font(.headline)
        ForEach(t.items.prefix(2), id: \.id) { task in
          Text(task.title).font(.caption).lineLimit(1)
        }
        if t.items.isEmpty { Text("Nothing due").font(.caption) }
      }
      .widgetURL(deepLink("/plan"))
      .containerBackground(for: .widget) { Color.clear }
    default:
      let rows = family == .systemSmall ? 3 : 4
      Card(dimmed: entry.dimmed, link: "/plan") {
        VStack(alignment: .leading, spacing: 6) {
          HStack {
            Caption(text: "Up next")
            Spacer()
            if t.overdue > 0 {
              Text("\(t.overdue) overdue").font(.system(size: 11, weight: .semibold)).foregroundStyle(Tone.warn)
            }
          }
          if t.items.isEmpty {
            Text("Nothing due. Enjoy the space.").font(.system(size: 13)).foregroundStyle(Tone.muted)
          }
          ForEach(t.items.prefix(rows), id: \.id) { task in
            Link(destination: deepLink("/tasks/task/\(task.id)")) {
              HStack(alignment: .top, spacing: 8) {
                Circle().stroke(task.overdue ? Tone.warn : Tone.tsk, lineWidth: 1.5)
                  .frame(width: 14, height: 14).padding(.top, 1)
                VStack(alignment: .leading, spacing: 0) {
                  Text(task.title).font(.system(size: 13, weight: .medium)).foregroundStyle(Tone.text).lineLimit(1)
                  if family != .systemSmall {
                    Text(task.when).font(.system(size: 10)).foregroundStyle(task.overdue ? Tone.warn : Tone.muted)
                  }
                }
              }
            }
          }
          Spacer(minLength: 0)
        }
      }
    }
  }
}

struct TasksWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "UnfurlTasks", provider: SnapshotProvider()) { TasksView(entry: $0) }
      .configurationDisplayName("Up next")
      .description("Overdue and upcoming tasks.")
      .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
  }
}

// MARK: - Money

struct MoneyView: View {
  @Environment(\.widgetFamily) var family
  var entry: SnapshotEntry
  var m: WidgetSnapshot.Money { entry.snap.money ?? WidgetSnapshot.sample.money! }
  var dimmed: Bool { entry.dimmed || entry.snap.money == nil }

  var body: some View {
    switch family {
    case .accessoryInline:
      Text("Safe today \(m.safeToday)")
        .privacySensitive()
        .widgetURL(deepLink("/finance"))
        .containerBackground(for: .widget) { Color.clear }
    case .accessoryRectangular:
      VStack(alignment: .leading, spacing: 2) {
        Text("\(m.safeToday) today").font(.headline)
        Text("\(m.left) left this month").font(.caption)
        Gauge(value: m.pct) {}.gaugeStyle(.accessoryLinearCapacity)
      }
      .privacySensitive()
      .widgetURL(deepLink("/finance"))
      .containerBackground(for: .widget) { Color.clear }
    default:
      Card(dimmed: dimmed, link: "/finance") {
        VStack(alignment: .leading, spacing: 6) {
          Caption(text: "Safe to spend")
          Text(m.safeToday)
            .font(.system(size: 28, weight: .semibold, design: .rounded).monospacedDigit())
            .foregroundStyle(Tone.text).minimumScaleFactor(0.5).lineLimit(1)
          Text("today").font(.system(size: 11)).foregroundStyle(Tone.muted)
          Spacer(minLength: 0)
          BarView(value: m.pct, color: m.pct > 0.9 ? Tone.warn : Tone.fin, height: 6)
          HStack {
            Text("\(m.left) left").font(.system(size: 11, weight: .medium)).foregroundStyle(Tone.text).lineLimit(1)
            Spacer()
            Text("\(whole(m.daysLeft))d").font(.system(size: 11).monospacedDigit()).foregroundStyle(Tone.muted)
          }
        }
      }
    }
  }
}

struct MoneyWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "UnfurlMoney", provider: SnapshotProvider()) { MoneyView(entry: $0) }
      .configurationDisplayName("Money")
      .description("What you can spend today and what's left of your budget.")
      .supportedFamilies([.systemSmall, .accessoryRectangular, .accessoryInline])
  }
}

@main
struct UnfurlWidgets: WidgetBundle {
  var body: some Widget {
    TodayWidget()
    HabitsWidget()
    MacrosWidget()
    TasksWidget()
    MoneyWidget()
    UnfurlLiveActivity()
  }
}
