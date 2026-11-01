// Widgets that start something rather than show a number: Fern's quick
// actions (chat, dictate, photo) and a launcher for each app in Unfurl, plus
// the iOS 18 controls for Control Center and the Lock Screen. Every button is
// a deep link the app resolves in src/app/+native-intent.tsx, so a route that
// moves needs no widget rebuild.

import AppIntents
import SwiftUI
import WidgetKit

// MARK: - Fern's mark and orb (docs/brand/fern.md)

/** The fiddlehead, from FERN_PATHS in src/prototype/companion/brand.tsx, on
 * the same 24-unit grid. */
struct FernMark: Shape {
  func path(in rect: CGRect) -> Path {
    let s = min(rect.width, rect.height) / 24
    let ox = rect.midX - 12 * s, oy = rect.midY - 12 * s
    func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: ox + x * s, y: oy + y * s) }
    var path = Path()
    path.move(to: p(7.5, 21.5))
    path.addCurve(to: p(11.6, 10.1), control1: p(7.5, 16.5), control2: p(8.6, 12.6))
    path.addCurve(to: p(18.9, 12.1), control1: p(14.2, 7.9), control2: p(18.7, 8.4))
    path.addCurve(to: p(14, 14.9), control1: p(19.1, 15), control2: p(16, 16.4))
    path.addCurve(to: p(14.8, 11.2), control1: p(12.5, 13.8), control2: p(12.9, 11.4))
    path.addCurve(to: p(16.2, 13.2), control1: p(16.1, 11.1), control2: p(16.9, 12.3))
    path.move(to: p(8, 18))
    path.addCurve(to: p(3.6, 18.5), control1: p(6.3, 17), control2: p(4.6, 17.2))
    path.move(to: p(8.9, 14.4))
    path.addCurve(to: p(4.7, 13.9), control1: p(7.5, 13.2), control2: p(5.8, 13))
    return path
  }
}

/** Fern's face: a moss-to-sprout gradient (bottom-left to top-right) with the
 * white fiddlehead at about 72% of its width. */
struct FernOrb: View {
  var size: CGFloat
  var body: some View {
    let mark = size * 0.72
    ZStack {
      Circle().fill(LinearGradient(colors: [Tone.moss, Tone.sprout], startPoint: .bottomLeading, endPoint: .topTrailing))
      FernMark()
        .stroke(.white, style: StrokeStyle(lineWidth: mark / 24 * (mark >= 28 ? 2 : 2.4), lineCap: .round, lineJoin: .round))
        .frame(width: mark, height: mark)
    }
    .frame(width: size, height: size)
    .accessibilityHidden(true)
  }
}

// MARK: - Fern quick actions

struct StaticEntry: TimelineEntry {
  let date: Date
}

/** Nothing here changes with time, so one entry serves until the widget is
 * redrawn. */
struct StaticProvider: TimelineProvider {
  func placeholder(in context: Context) -> StaticEntry { StaticEntry(date: Date()) }
  func getSnapshot(in context: Context, completion: @escaping (StaticEntry) -> Void) {
    completion(StaticEntry(date: Date()))
  }
  func getTimeline(in context: Context, completion: @escaping (Timeline<StaticEntry>) -> Void) {
    completion(Timeline(entries: [StaticEntry(date: Date())], policy: .never))
  }
}

func fernLink(_ mode: String) -> URL { deepLink("/fern?mode=\(mode)") }

/** The fill behind Fern's buttons. Fern's own mist token is nearly the dark
 * card's colour, so the buttons would vanish in dark mode; a light frond
 * tint reads in both. */
let fernSoft = Tone.frond.opacity(0.14)

/** The big button: Fern's orb and a label on a soft Fern tint, opening the
 * chat ready to type. */
struct FernPill: View {
  var label: String
  var height: CGFloat
  var body: some View {
    Link(destination: fernLink("chat")) {
      HStack(spacing: 10) {
        FernOrb(size: height - 16)
        Text(label)
          .font(.system(size: 17, weight: .semibold, design: .rounded))
          .foregroundStyle(Tone.text)
          .lineLimit(1)
          .minimumScaleFactor(0.8)
        Spacer(minLength: 0)
      }
      .padding(.leading, 8)
      .padding(.trailing, 12)
      .frame(maxWidth: .infinity)
      .frame(height: height)
      .background(Capsule().fill(fernSoft))
    }
    .accessibilityLabel("Chat with Fern")
  }
}

/** A round action: camera or dictation. */
struct FernRound: View {
  var mode: String
  var symbol: String
  var label: String
  var body: some View {
    Link(destination: fernLink(mode)) {
      Circle().fill(fernSoft)
        .overlay(Image(systemName: symbol).font(.system(size: 20, weight: .medium)).foregroundStyle(Tone.frond))
    }
    .accessibilityLabel(label)
  }
}

/** A labelled action for the wider widgets. */
struct FernAction: View {
  var mode: String
  var symbol: String
  var label: String
  var height: CGFloat
  var body: some View {
    Link(destination: fernLink(mode)) {
      HStack(spacing: 6) {
        Image(systemName: symbol).font(.system(size: 15, weight: .medium)).foregroundStyle(Tone.frond)
        Text(label).font(.system(size: 14, weight: .medium)).foregroundStyle(Tone.text).lineLimit(1)
      }
      .frame(maxWidth: .infinity)
      .frame(height: height)
      .background(Capsule().fill(fernSoft))
    }
  }
}

struct FernView: View {
  @Environment(\.widgetFamily) var family

  var body: some View {
    Group {
      switch family {
      case .systemMedium:
        HStack(spacing: 12) {
          // The logo opens the app itself.
          Link(destination: deepLink("/today")) {
            VStack(spacing: 8) {
              FernOrb(size: 64)
              Text("Unfurl").font(.system(size: 13, weight: .semibold, design: .rounded)).foregroundStyle(Tone.text)
            }
            .frame(maxHeight: .infinity)
            .padding(.horizontal, 6)
          }
          .accessibilityLabel("Open Unfurl")
          VStack(spacing: 10) {
            FernPill(label: "Chat with Fern", height: 56)
            HStack(spacing: 10) {
              FernAction(mode: "camera", symbol: "camera", label: "Photo", height: 48)
              FernAction(mode: "dictate", symbol: "mic", label: "Dictate", height: 48)
            }
          }
        }
      default:
        VStack(spacing: 10) {
          FernPill(label: "Chat", height: 56)
          HStack(spacing: 10) {
            FernRound(mode: "camera", symbol: "camera", label: "Photo for Fern")
            FernRound(mode: "dictate", symbol: "mic", label: "Dictate to Fern")
          }
        }
      }
    }
    // A tap anywhere else opens the app.
    .widgetURL(deepLink("/today"))
    .containerBackground(for: .widget) { Tone.card }
  }
}

struct FernWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "UnfurlFern", provider: StaticProvider()) { _ in FernView() }
      .configurationDisplayName("Fern")
      .description("Chat with Fern, dictate, or send a photo in one tap.")
      .supportedFamilies([.systemSmall, .systemMedium])
  }
}

// MARK: - Apps launcher

/** One app in Unfurl as the in-app launcher shows it (AppLauncher in
 * src/prototype/app-launcher.tsx): its name, its colour and an SF Symbol
 * close to its icon there. */
struct UnfurlApp {
  let key: String
  let label: String
  let symbol: String
  let tone: Color

  static let all: [UnfurlApp] = [
    .init(key: "habits", label: "Habits", symbol: "target", tone: Tone.hab),
    .init(key: "tasks", label: "Tasks", symbol: "checkmark.square", tone: Tone.tsk),
    .init(key: "fitness", label: "Fitness", symbol: "dumbbell", tone: Tone.fit),
    .init(key: "nutrition", label: "Nutrition", symbol: "fork.knife", tone: Tone.nut),
    .init(key: "focus", label: "Focus", symbol: "timer", tone: Tone.foc),
    .init(key: "finance", label: "Finance", symbol: "wallet.bifold", tone: Tone.fin),
    .init(key: "screen", label: "Screen time", symbol: "iphone", tone: Tone.scr),
    .init(key: "journal", label: "Journal", symbol: "book", tone: Tone.life),
  ]
  /** Before the app has written which apps are on: every app but Screen
   * Time, which needs a permission most builds do not have. */
  static let fallback = all.filter { $0.key != "screen" }
}

struct AppsEntry: TimelineEntry {
  let date: Date
  let apps: [UnfurlApp]
}

struct AppsProvider: TimelineProvider {
  static func current() -> [UnfurlApp] {
    guard let keys = SharedStore.snapshot()?.apps else { return UnfurlApp.fallback }
    return keys.compactMap { k in UnfurlApp.all.first { $0.key == k } }
  }
  func placeholder(in context: Context) -> AppsEntry { AppsEntry(date: Date(), apps: UnfurlApp.fallback) }
  func getSnapshot(in context: Context, completion: @escaping (AppsEntry) -> Void) {
    completion(AppsEntry(date: Date(), apps: Self.current()))
  }
  func getTimeline(in context: Context, completion: @escaping (Timeline<AppsEntry>) -> Void) {
    // The app reloads the timelines whenever it writes a new snapshot.
    completion(Timeline(entries: [AppsEntry(date: Date(), apps: Self.current())], policy: .never))
  }
}

struct AppTile: View {
  var app: UnfurlApp
  var box: CGFloat
  var body: some View {
    Link(destination: deepLink("/feature/\(app.key)")) {
      VStack(spacing: 5) {
        RoundedRectangle(cornerRadius: box * 0.29, style: .continuous)
          .fill(app.tone.opacity(0.15))
          .frame(width: box, height: box)
          .overlay(Image(systemName: app.symbol).font(.system(size: box * 0.42, weight: .medium)).foregroundStyle(app.tone))
        Text(app.label)
          .font(.system(size: 11, weight: .medium))
          .foregroundStyle(Tone.text)
          .lineLimit(1)
          .minimumScaleFactor(0.75)
      }
      .frame(maxWidth: .infinity)
    }
    .accessibilityLabel(app.label)
  }
}

struct AppsGrid: View {
  var apps: [UnfurlApp]
  var box: CGFloat
  var spacing: CGFloat
  var body: some View {
    // Four to a row, the last row padded so tiles keep one width.
    let rows = stride(from: 0, to: apps.count, by: 4).map { Array(apps[$0..<min($0 + 4, apps.count)]) }
    VStack(spacing: spacing) {
      ForEach(rows.indices, id: \.self) { r in
        HStack(spacing: 4) {
          ForEach(rows[r], id: \.key) { AppTile(app: $0, box: box) }
          ForEach(0..<(4 - rows[r].count), id: \.self) { _ in Color.clear.frame(maxWidth: .infinity) }
        }
      }
    }
  }
}

struct AppsView: View {
  @Environment(\.widgetFamily) var family
  var entry: AppsEntry

  var body: some View {
    Group {
      if family == .systemLarge {
        VStack(alignment: .leading, spacing: 14) {
          Link(destination: deepLink("/today")) {
            HStack(spacing: 8) {
              FernOrb(size: 28)
              Text("Unfurl").font(.system(size: 17, weight: .semibold, design: .rounded)).foregroundStyle(Tone.text)
              Spacer()
            }
          }
          .accessibilityLabel("Open Unfurl")
          HStack(spacing: 10) {
            FernPill(label: "Ask Fern", height: 52)
            FernRound(mode: "camera", symbol: "camera", label: "Photo for Fern").frame(width: 52, height: 52)
            FernRound(mode: "dictate", symbol: "mic", label: "Dictate to Fern").frame(width: 52, height: 52)
          }
          Spacer(minLength: 0)
          AppsGrid(apps: entry.apps, box: 52, spacing: 14)
          Spacer(minLength: 0)
        }
      } else {
        AppsGrid(apps: entry.apps, box: 44, spacing: 8)
      }
    }
    .widgetURL(deepLink("/today"))
    .containerBackground(for: .widget) { Tone.card }
  }
}

struct AppsWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "UnfurlApps", provider: AppsProvider()) { AppsView(entry: $0) }
      .configurationDisplayName("Apps")
      .description("Open Habits, Tasks, Finance, Journal and the rest in one tap.")
      .supportedFamilies([.systemMedium, .systemLarge])
  }
}

// MARK: - Controls (iOS 18: Control Center, Lock Screen, Action button)

@available(iOS 18.0, *)
struct AskFernControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: "com.schadenkai.personal-sop.ask-fern") {
      ControlWidgetButton(action: OpenFernIntent(mode: "chat")) {
        Label("Ask Fern", systemImage: "leaf.fill")
      }
    }
    .displayName("Ask Fern")
    .description("Open Fern ready to type.")
  }
}

@available(iOS 18.0, *)
struct DictateFernControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: "com.schadenkai.personal-sop.dictate-fern") {
      ControlWidgetButton(action: OpenFernIntent(mode: "dictate")) {
        Label("Dictate to Fern", systemImage: "mic.fill")
      }
    }
    .displayName("Dictate to Fern")
    .description("Open Fern and start talking.")
  }
}
