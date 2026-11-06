// Today's steps against the step goal: small and medium home-screen widgets
// and the lock-screen accessories. The count is the app's last Apple Health
// read (the snapshot's `steps`, written when the app opens and every few
// minutes while it stays open), raised to the iPhone's own motion count for
// today when that is higher, so the widget keeps moving between app opens.
// The motion count is a cheap read of what the motion coprocessor already
// stored; the timeline asks for it at most every 30 minutes.

import CoreMotion
import SwiftUI
import WidgetKit

struct StepsEntry: TimelineEntry {
  let date: Date
  let count: Int
  let goal: Int
  /** No step source: Fitness off, Health not connected, or no snapshot. */
  let dimmed: Bool

  var share: Double { goal > 0 ? min(1, Double(count) / Double(goal)) : 0 }
  var hit: Bool { goal > 0 && count >= goal }
  var toGo: Int { max(0, goal - count) }

  static let sample = StepsEntry(date: Date(), count: 6_240, goal: 10_000, dimmed: false)
}

/** The calendar day (YYYY-MM-DD) of `date`, as Health and the app's
 * StepsReading count days: midnight to midnight, on this device. */
func calendarDay(_ date: Date) -> String {
  let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
  return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
}

enum PhoneSteps {
  private static let pedometer = CMPedometer()

  /** Steps the iPhone counted from midnight to `now`; nil without motion
   * access (the widget never asks for it: the app's runs do) or a counter. */
  static func today(_ now: Date, done: @escaping (Int?) -> Void) {
    guard CMPedometer.isStepCountingAvailable(),
          CMPedometer.authorizationStatus() == .authorized
    else { return done(nil) }
    pedometer.queryPedometerData(from: Calendar.current.startOfDay(for: now), to: now) { data, error in
      done(error == nil ? data.map { $0.numberOfSteps.intValue } : nil)
    }
  }
}

struct StepsProvider: TimelineProvider {
  /** How often the widget asks again on its own; the app also reloads it
   * whenever it writes a new count. 48 a day stays well inside WidgetKit's
   * daily reload budget. */
  static let refresh: TimeInterval = 30 * 60

  func placeholder(in context: Context) -> StepsEntry { .sample }

  func getSnapshot(in context: Context, completion: @escaping (StepsEntry) -> Void) {
    if context.isPreview && SharedStore.snapshot()?.steps == nil { return completion(.sample) }
    entry(at: Date(), completion)
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<StepsEntry>) -> Void) {
    let now = Date()
    entry(at: now) { e in
      // Back at midnight too, so the new day starts from the new day's count.
      let midnight = Calendar.current.startOfDay(for: now.addingTimeInterval(86_400))
      let next = min(now.addingTimeInterval(Self.refresh), midnight.addingTimeInterval(60))
      // With no step source, only the app writing a snapshot changes it.
      completion(Timeline(entries: [e], policy: e.dimmed ? .never : .after(next)))
    }
  }

  private func entry(at now: Date, _ done: @escaping (StepsEntry) -> Void) {
    guard let steps = SharedStore.snapshot()?.steps else {
      return done(StepsEntry(date: now, count: StepsEntry.sample.count, goal: StepsEntry.sample.goal, dimmed: true))
    }
    // A count from an earlier day is not today's: start from 0.
    let read = steps.day == calendarDay(now) ? steps.count : 0
    PhoneSteps.today(now) { phone in
      done(StepsEntry(date: now, count: max(read, phone ?? 0), goal: steps.goal, dimmed: false))
    }
  }
}

struct StepsView: View {
  @Environment(\.widgetFamily) var family
  var entry: StepsEntry
  var color: Color { entry.hit ? Tone.good : Tone.fit }
  var count: String { entry.count.formatted() }
  var goal: String { entry.goal.formatted() }
  var remaining: String { entry.hit ? "Goal reached" : "\(entry.toGo.formatted()) to go" }
  /** The lock screen has no dimmed card: with no step source it shows a
   * dash rather than the sample count. */
  var lockCount: String { entry.dimmed ? "—" : count }
  var lockShare: Double { entry.dimmed ? 0 : entry.share }
  var spoken: String {
    if entry.dimmed { return "Steps. Open Unfurl to connect Apple Health" }
    return "\(count) of \(goal) steps today" + (entry.hit ? ", goal reached" : ", \(entry.toGo.formatted()) to go")
  }

  var body: some View {
    switch family {
    case .accessoryCircular:
      Gauge(value: lockShare) {
        Image(systemName: "figure.walk")
      } currentValueLabel: {
        Text(entry.dimmed ? "—" : short(entry.count)).minimumScaleFactor(0.6)
      }
      .gaugeStyle(.accessoryCircularCapacity)
      .accessibilityLabel(spoken)
      .widgetURL(deepLink("/fitness/steps"))
      .containerBackground(for: .widget) { Color.clear }
    case .accessoryRectangular:
      VStack(alignment: .leading, spacing: 2) {
        Label("\(lockCount) steps", systemImage: "figure.walk").font(.headline).lineLimit(1).minimumScaleFactor(0.7)
        Text(entry.dimmed ? "Open Unfurl" : remaining).font(.caption).lineLimit(1)
        Gauge(value: lockShare) {}.gaugeStyle(.accessoryLinearCapacity)
      }
      .accessibilityElement(children: .ignore)
      .accessibilityLabel(spoken)
      .widgetURL(deepLink("/fitness/steps"))
      .containerBackground(for: .widget) { Color.clear }
    case .accessoryInline:
      Label(entry.dimmed ? "Steps" : "\(count) / \(goal) steps", systemImage: "figure.walk")
        .widgetURL(deepLink("/fitness/steps"))
        .containerBackground(for: .widget) { Color.clear }
    case .systemMedium:
      Card(dimmed: entry.dimmed, link: "/fitness/steps") {
        HStack(spacing: 16) {
          ring(size: 92)
          VStack(alignment: .leading, spacing: 4) {
            Caption(text: "Steps today")
            Text(count)
              .font(.system(size: 28, weight: .semibold, design: .rounded).monospacedDigit())
              .foregroundStyle(Tone.text).lineLimit(1).minimumScaleFactor(0.6)
            Text("of \(goal)").font(.system(size: 12)).foregroundStyle(Tone.muted).lineLimit(1)
            Spacer(minLength: 0)
            BarView(value: entry.share, color: color, height: 6)
            Text(remaining).font(.system(size: 12, weight: .semibold))
              .foregroundStyle(entry.hit ? Tone.good : Tone.text).lineLimit(1)
          }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken)
      }
    default:
      Card(dimmed: entry.dimmed, link: "/fitness/steps") {
        VStack(alignment: .leading, spacing: 6) {
          HStack(spacing: 4) {
            Caption(text: "Steps")
            Spacer()
            Image(systemName: "figure.walk").font(.system(size: 11, weight: .semibold)).foregroundStyle(Tone.fit)
          }
          ring(size: 70).frame(maxWidth: .infinity)
          Text(remaining).font(.system(size: 13, weight: .semibold))
            .foregroundStyle(entry.hit ? Tone.good : Tone.text).lineLimit(1).minimumScaleFactor(0.8)
            .frame(maxWidth: .infinity)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken)
      }
    }
  }

  func ring(size: CGFloat) -> some View {
    ZStack {
      RingView(value: entry.share, color: color, width: size / 10)
      VStack(spacing: 0) {
        Text(count)
          .font(.system(size: size * 0.22, weight: .semibold, design: .rounded).monospacedDigit())
          .foregroundStyle(Tone.text).lineLimit(1).minimumScaleFactor(0.6)
        Text("\(Int((entry.share * 100).rounded()))%")
          .font(.system(size: size * 0.13).monospacedDigit()).foregroundStyle(Tone.muted)
      }
      .padding(.horizontal, size / 7)
    }
    .frame(width: size, height: size)
  }

  /** "6.2k" for the small lock-screen ring; under 1,000 as is. */
  func short(_ n: Int) -> String {
    n < 1_000 ? "\(n)" : (Double(n) / 1_000).formatted(.number.precision(.fractionLength(n < 10_000 ? 1 : 0))) + "k"
  }
}

struct StepsWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "UnfurlSteps", provider: StepsProvider()) { StepsView(entry: $0) }
      .configurationDisplayName("Steps")
      .description("Today's steps against your daily goal.")
      .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline])
  }
}
