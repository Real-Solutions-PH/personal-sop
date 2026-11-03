// The running routine, workout, habit timer or run on the lock screen and
// in the Dynamic Island, with any other session running beside it as one
// line each underneath. Clocks are SwiftUI timer texts, so they count without the
// app pushing updates; buttons run LiveControlIntent (UnfurlShared.swift).

import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

func liveAccent(_ kind: String) -> Color { kind == "workout" || kind == "run" ? Tone.fit : Tone.hab }
func liveSymbol(_ kind: String, icon: String) -> String {
  switch kind {
  case "workout": return "figure.strengthtraining.traditional"
  case "timer": return "timer"
  case "run": return icon == "🚶" ? "figure.walk" : "figure.run"
  default: return "list.bullet.circle"
  }
}

extension LiveState {
  var accent: Color { liveAccent(kind) }
  var symbol: String { liveSymbol(kind, icon: icon) }
  /** The header's name: a workout's or a run's own symbol already says
   * what it is, so its emoji is left out (two icons side by side read as
   * noise). */
  var heading: String { kind == "workout" || kind == "run" || icon.isEmpty ? title : "\(icon) \(title)" }
  /** What comes after the step shown. The same exercise again says which
   * set ("set 2 of 2"); another one is named. Repeating the exercise's name
   * ("Next: Cable Hammer Curl" under Cable Hammer Curl) read as a mistake. */
  var then: String? {
    guard let n = next.first else { return nil }
    guard kind == "workout", n.label == step else { return n.label }
    let which = n.detail.components(separatedBy: " · ").first ?? n.detail
    return which.prefix(1).lowercased() + which.dropFirst()
  }
  /** "Then set 2 of 2 · Best 85 kg × 6": what follows first, the previous
   * best after it, so a cut-off drops the best. Nil when there is neither. */
  var upNext: String? {
    let parts = [then.map { "Then \($0)" }, best].compactMap { $0 }
    return parts.isEmpty ? nil : parts.joined(separator: " · ")
  }
  /** The buttons drawn. While resting a workout shows −15 s, +15 s and
   * Skip rest only: a Finish beside them read as "finish the rest". Ending
   * the workout stays on the between-sets row and in the app. */
  var shownControls: [String] {
    resting && kind == "workout" ? controls.filter { $0 != "finish" } : controls
  }
  /** Workout sets done of all, for the header ("3 of 14 sets"). */
  var setsLine: String? {
    kind == "workout" && count > 0 ? "\(min(index, count)) of \(count) sets" : nil
  }
}

/** The clock that matters now: rest, then the step or timer goal counting
 * down, then time since the start counting up. */
struct LiveClock: View {
  var state: LiveState
  var size: CGFloat = 34

  var body: some View {
    Group {
      if let rest = state.restEnd, rest > Date() {
        Text(timerInterval: Date()...rest, countsDown: true)
      } else if state.paused {
        Text(Self.format(state.remainingSec ?? state.elapsedSec))
      } else if let end = state.stepEnd {
        Text(timerInterval: min(Date(), end)...end, countsDown: true)
      } else {
        Text(state.startDate, style: .timer)
      }
    }
    .font(.system(size: size, weight: .semibold, design: .rounded).monospacedDigit())
    .multilineTextAlignment(.trailing)
    // An hour-long workout's "1:22:21" shrinks rather than wrapping.
    .lineLimit(1)
    .minimumScaleFactor(0.6)
  }

  var label: String {
    if state.resting { return "Rest" }
    if state.paused { return "Paused" }
    if state.kind == "run" { return "Moving" }
    return state.stepEnd != nil ? "Left" : "Elapsed"
  }

  static func format(_ sec: Double) -> String {
    let s = Int(max(0, sec))
    return s >= 3600
      ? String(format: "%d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60)
      : String(format: "%d:%02d", s / 60, s % 60)
  }
}

/** One segment per step, or a plain bar when there are too many to tell
 * apart. A workout has none: its header says "6 of 14 sets", and while
 * resting the countdown is the progress that matters. */
struct LiveProgress: View {
  var state: LiveState
  var body: some View {
    if state.kind == "workout" {
      EmptyView()
    } else if state.count > 0 && state.count <= 12 {
      HStack(spacing: 3) {
        ForEach(0..<state.count, id: \.self) { i in
          Capsule()
            .fill(i < state.index ? state.accent : (i == state.index ? state.accent.opacity(0.45) : Tone.soft))
            .frame(height: 4)
        }
      }
    } else if state.count > 0 {
      BarView(value: state.progress, color: state.accent, height: 4)
    }
  }
}

/** A control on the lock screen or in the Dynamic Island. Its title shows
 * while title and symbol fit whole in the button's share of the row; when
 * they would be cut off it keeps only the symbol. The full name is always
 * the accessibility label, and the button is 44pt tall. */
struct LiveButton: View {
  var action: String
  var state: LiveState
  var body: some View {
    let (title, symbol, primary, name) = Self.look(action, kind: state.kind)
    Button(intent: LiveControlIntent(action, state: state)) {
      ViewThatFits(in: .horizontal) {
        Label(title, systemImage: symbol).labelStyle(.titleAndIcon).fixedSize()
        Label(title, systemImage: symbol).labelStyle(.iconOnly).font(.system(size: 16, weight: .semibold))
      }
      .font(.system(size: 14, weight: .semibold))
      .padding(.horizontal, 4)
      .frame(maxWidth: .infinity, minHeight: 36)
      .foregroundStyle(primary ? Tone.card : Tone.text)
      .background(Capsule().fill(primary ? Tone.primary : Tone.soft))
      .contentShape(Capsule())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(name)
  }

  static func look(_ action: String, kind: String) -> (String, String, Bool, String) {
    switch action {
    case "done": return ("Done", "checkmark", true, "Step done")
    case "skip": return ("Skip", "forward.end", false, "Skip step")
    case "pause": return ("Pause", "pause.fill", false, kind == "routine" ? "Pause routine" : kind == "run" ? "Pause session" : "Pause timer")
    case "resume": return ("Resume", "play.fill", false, kind == "routine" ? "Resume routine" : kind == "run" ? "Resume session" : "Resume timer")
    case "finishSet": return ("Set done", "checkmark", true, "Complete set")
    // Skipping rest starts the next set: the one filled button while resting.
    case "skipRest": return ("Skip rest", "forward.end.fill", true, "Skip rest")
    // The sign is the symbol, the amount the title: "− 15s", with no clock
    // arrow repeating the 15.
    case "subRest": return ("15s", "minus", false, "Rest 15 seconds less")
    case "addRest": return ("15s", "plus", false, "Rest 15 seconds more")
    case "finish":
      // Says what ends, so it is never read as finishing the set.
      let title = kind == "workout" ? "End workout" : "Finish"
      let name = kind == "workout" ? "End workout" : kind == "routine" ? "Finish routine" : "Finish timer"
      return (title, "flag.checkered", false, name)
    default: return (action, "circle", false, action)
    }
  }
}

/** A run's or walk's steps so far, grouped ("12,345"), with its glyph:
 * the number speaks for itself beside the shoeprints. */
struct StepsLabel: View {
  var steps: Int
  var size: CGFloat
  var color: Color
  var body: some View {
    let n = steps.formatted(.number.grouping(.automatic))
    Label {
      Text(n)
    } icon: {
      Image(systemName: "shoeprints.fill")
    }
    .labelStyle(.titleAndIcon)
    .font(.system(size: size).monospacedDigit())
    .foregroundStyle(color)
    .fixedSize()
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("\(n) steps")
  }
}

/** Lock screen. The clock that matters now is the largest thing, on the
 * right: rest while resting (in the accent, with a bar draining under it),
 * else the step's countdown or the time since the start. Left of it, what
 * to do: the exercise and the set with its load. The header names the
 * session and, for a workout, how far through it is and (while the big
 * clock is rest) the time since the start. Under the bar, what follows. */
struct LiveLockScreen: View {
  var state: LiveState
  var body: some View {
    VStack(alignment: .leading, spacing: 5) {
      HStack(spacing: 6) {
        Image(systemName: state.symbol).font(.system(size: 13, weight: .semibold)).foregroundStyle(state.accent)
        Text(state.heading).font(.system(size: 13, weight: .semibold))
          .foregroundStyle(Tone.text).lineLimit(1)
        if let sets = state.setsLine {
          Text(sets).font(.system(size: 13)).foregroundStyle(Tone.muted).fixedSize()
        }
        Spacer(minLength: 6)
        // The time since the start, when the big clock is something else.
        if state.kind == "workout" || state.kind == "routine", state.resting || state.stepEnd != nil || state.paused {
          Label {
            Text(state.startDate, style: .timer)
              .multilineTextAlignment(.trailing)
              .frame(maxWidth: 62, alignment: .trailing)
          } icon: {
            Image(systemName: "stopwatch")
          }
          .labelStyle(.titleAndIcon)
          .font(.system(size: 13).monospacedDigit())
          .foregroundStyle(Tone.muted)
          .accessibilityLabel("Workout time")
        }
        if state.kind == "run", let steps = state.steps {
          StepsLabel(steps: steps, size: 13, color: Tone.muted)
        }
      }
      HStack(alignment: .center, spacing: 10) {
        VStack(alignment: .leading, spacing: 1) {
          // The exercise is why the activity exists: a long name wraps.
          Text(state.step).font(.system(size: 19, weight: .semibold)).foregroundStyle(Tone.text)
            .lineLimit(2).minimumScaleFactor(0.85)
          Text(state.detail).font(.system(size: 14)).foregroundStyle(Tone.text.opacity(0.8))
            .lineLimit(1).minimumScaleFactor(0.85)
        }
        Spacer(minLength: 6)
        VStack(alignment: .trailing, spacing: 0) {
          LiveClock(state: state, size: 32).foregroundStyle(state.resting ? state.accent : Tone.text)
            .frame(maxWidth: 124, alignment: .trailing)
          Text(LiveClock(state: state).label.uppercased())
            .font(.system(size: 10, weight: .semibold)).tracking(0.8)
            .foregroundStyle(state.resting ? state.accent : Tone.muted)
        }
      }
      LiveProgress(state: state)
      // With another session's row below there is no room for both.
      if state.others?.isEmpty ?? true, let upNext = state.upNext {
        Text(upNext).font(.system(size: 13)).foregroundStyle(Tone.muted)
          .lineLimit(1).truncationMode(.tail)
      }
      if #available(iOS 17.0, *) {
        HStack(spacing: 8) {
          ForEach(state.shownControls.prefix(4), id: \.self) { LiveButton(action: $0, state: state) }
        }
        .padding(.top, 2)
      }
      ForEach((state.others ?? []).prefix(2), id: \.self) { OtherRow(other: $0) }
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 10)
  }
}

/** A session running beside the main one: its symbol, what it is and
 * where it stands, and its own clock. Tapping the activity opens the main
 * one; this row says the other is still going. */
struct OtherRow: View {
  var other: LiveOther
  var body: some View {
    HStack(spacing: 8) {
      Image(systemName: liveSymbol(other.kind, icon: other.icon))
        .font(.system(size: 13)).foregroundStyle(liveAccent(other.kind))
        .frame(width: 18)
      Text(other.title).font(.system(size: 13, weight: .semibold)).foregroundStyle(Tone.text).lineLimit(1)
      Text(other.paused ? "Paused" : other.line).font(.system(size: 12)).foregroundStyle(Tone.muted)
        .lineLimit(1).truncationMode(.tail)
      Spacer(minLength: 6)
      Group {
        if let rest = other.restEnd, rest > Date() {
          Text(timerInterval: Date()...rest, countsDown: true)
        } else if other.paused {
          Text(LiveClock.format(other.remainingSec ?? other.elapsedSec))
        } else if let end = other.stepEnd {
          Text(timerInterval: min(Date(), end)...end, countsDown: true)
        } else {
          Text(other.startDate, style: .timer)
        }
      }
      .font(.system(size: 13, weight: .medium).monospacedDigit())
      .foregroundStyle(Tone.text)
      .multilineTextAlignment(.trailing)
      .frame(maxWidth: 64, alignment: .trailing)
    }
    .padding(.top, 2)
    .overlay(alignment: .top) { Rectangle().fill(Tone.soft).frame(height: 1).offset(y: -3) }
  }
}

/** The Dynamic Island's expanded regions and its minimal view, as views
 * of their own. */
struct IslandLeading: View {
  var state: LiveState
  var body: some View {
    HStack(spacing: 6) {
      Image(systemName: state.symbol).foregroundStyle(state.accent)
      Text(state.heading).font(.system(size: 14, weight: .semibold)).lineLimit(1)
    }
    .padding(.leading, 4)
  }
}

struct IslandTrailing: View {
  var state: LiveState
  var body: some View {
    VStack(alignment: .trailing, spacing: 0) {
      LiveClock(state: state, size: 24).foregroundStyle(state.resting ? state.accent : .white)
        .frame(maxWidth: 96, alignment: .trailing)
      Text(LiveClock(state: state).label.uppercased())
        .font(.system(size: 9, weight: .semibold)).tracking(0.8)
        .foregroundStyle(state.resting ? state.accent : .secondary)
    }
    .padding(.trailing, 4)
  }
}

struct IslandBottom: View {
  var state: LiveState
  var body: some View {
    VStack(alignment: .leading, spacing: 7) {
      VStack(alignment: .leading, spacing: 1) {
        Text(state.step).font(.system(size: 17, weight: .semibold)).lineLimit(2).minimumScaleFactor(0.85)
        HStack(spacing: 8) {
          Text(state.detail).font(.system(size: 13)).foregroundStyle(.white.opacity(0.8)).lineLimit(1)
          if state.kind == "run", let steps = state.steps {
            Spacer(minLength: 4)
            StepsLabel(steps: steps, size: 13, color: .white.opacity(0.8))
          }
        }
      }
      LiveProgress(state: state)
      if let upNext = state.upNext {
        Text(upNext).font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(1)
      }
      if #available(iOS 17.0, *) {
        HStack(spacing: 8) {
          ForEach(state.shownControls.prefix(3), id: \.self) { LiveButton(action: $0, state: state) }
        }
      }
      ForEach((state.others ?? []).prefix(1), id: \.self) { o in
        HStack(spacing: 6) {
          Image(systemName: liveSymbol(o.kind, icon: o.icon)).font(.system(size: 11)).foregroundStyle(liveAccent(o.kind))
          Text("\(o.title) · \(o.paused ? "Paused" : o.line)").font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(1)
        }
      }
    }
    .padding(.horizontal, 4)
  }
}

/** Resting: the countdown itself, the one thing worth a glance; otherwise
 * how far through, around the session's symbol. */
struct IslandMinimal: View {
  var state: LiveState
  var body: some View {
    if state.resting, let rest = state.restEnd {
      Text(timerInterval: Date()...rest, countsDown: true)
        .font(.system(size: 12, weight: .semibold, design: .rounded).monospacedDigit())
        .foregroundStyle(state.accent)
        .multilineTextAlignment(.center)
        .frame(maxWidth: 36)
    } else {
      ZStack {
        RingView(value: state.progress, color: state.accent, width: 3)
        Image(systemName: state.symbol).font(.system(size: 10)).foregroundStyle(state.accent)
      }
    }
  }
}

struct UnfurlLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: UnfurlActivityAttributes.self) { context in
      LiveLockScreen(state: context.state)
        .activityBackgroundTint(Tone.card)
        .activitySystemActionForegroundColor(Tone.text)
        .widgetURL(deepLink(context.state.href))
    } dynamicIsland: { context in
      let s = context.state
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) { IslandLeading(state: s) }
        DynamicIslandExpandedRegion(.trailing) { IslandTrailing(state: s) }
        DynamicIslandExpandedRegion(.bottom) { IslandBottom(state: s) }
      } compactLeading: {
        Image(systemName: s.symbol).foregroundStyle(s.accent)
      } compactTrailing: {
        LiveClock(state: s, size: 14).foregroundStyle(s.resting ? s.accent : .white)
          .frame(maxWidth: 52)
      } minimal: {
        IslandMinimal(state: s)
      }
      .widgetURL(deepLink(s.href))
      .keylineTint(s.accent)
    }
  }
}
