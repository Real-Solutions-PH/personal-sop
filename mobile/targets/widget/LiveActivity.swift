// The running routine, workout or habit timer on the lock screen and in the
// Dynamic Island. Clocks are SwiftUI timer texts, so they count without the
// app pushing updates; buttons run LiveControlIntent (UnfurlShared.swift).

import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

extension LiveState {
  var accent: Color { kind == "workout" ? Tone.fit : Tone.hab }
  var symbol: String {
    switch kind {
    case "workout": return "figure.strengthtraining.traditional"
    case "timer": return "timer"
    default: return "list.bullet.circle"
    }
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
  }

  var label: String {
    if state.resting { return "Rest" }
    if state.paused { return "Paused" }
    return state.stepEnd != nil ? "Left" : "Elapsed"
  }

  static func format(_ sec: Double) -> String {
    let s = Int(max(0, sec))
    return s >= 3600
      ? String(format: "%d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60)
      : String(format: "%d:%02d", s / 60, s % 60)
  }
}

struct LiveProgress: View {
  var state: LiveState
  var body: some View {
    if state.count > 0 && state.count <= 12 {
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

struct LiveButton: View {
  var action: String
  var state: LiveState
  var body: some View {
    let (title, symbol, primary) = Self.look(action)
    Button(intent: LiveControlIntent(action, state: state)) {
      Label(title, systemImage: symbol)
        .font(.system(size: 13, weight: .semibold))
        .labelStyle(.titleAndIcon)
        .lineLimit(1)
        .frame(maxWidth: .infinity, minHeight: 34)
        .foregroundStyle(primary ? Tone.card : Tone.text)
        .background(Capsule().fill(primary ? Tone.primary : Tone.soft))
    }
    .buttonStyle(.plain)
    .accessibilityLabel(title)
  }

  static func look(_ action: String) -> (String, String, Bool) {
    switch action {
    case "done": return ("Done", "checkmark", true)
    case "skip": return ("Skip", "forward.end", false)
    case "pause": return ("Pause", "pause.fill", false)
    case "resume": return ("Resume", "play.fill", false)
    case "finishSet": return ("Set done", "checkmark", true)
    case "skipRest": return ("Skip rest", "forward.end", false)
    case "addRest": return ("+30s", "plus", false)
    case "finish": return ("Finish", "flag.checkered", false)
    default: return (action, "circle", false)
    }
  }
}

struct LiveLockScreen: View {
  var state: LiveState
  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 6) {
        Image(systemName: state.symbol).foregroundStyle(state.accent)
        Text("\(state.icon) \(state.title)").font(.system(size: 13, weight: .medium))
          .foregroundStyle(Tone.muted).lineLimit(1)
        Spacer()
        if state.kind != "timer" {
          Text(state.startDate, style: .timer)
            .font(.system(size: 12).monospacedDigit()).foregroundStyle(Tone.muted)
            .multilineTextAlignment(.trailing).frame(maxWidth: 70, alignment: .trailing)
        }
      }
      HStack(alignment: .firstTextBaseline) {
        VStack(alignment: .leading, spacing: 2) {
          Text(state.step).font(.system(size: 18, weight: .semibold)).foregroundStyle(Tone.text).lineLimit(1)
          Text(state.detail).font(.system(size: 13)).foregroundStyle(Tone.muted).lineLimit(1)
        }
        Spacer(minLength: 8)
        VStack(alignment: .trailing, spacing: 0) {
          LiveClock(state: state, size: 30).foregroundStyle(state.resting ? state.accent : Tone.text)
            .frame(maxWidth: 120, alignment: .trailing)
          Text(LiveClock(state: state).label.uppercased())
            .font(.system(size: 9, weight: .semibold)).tracking(0.8).foregroundStyle(Tone.muted)
        }
      }
      LiveProgress(state: state)
      if #available(iOS 17.0, *) {
        HStack(spacing: 8) {
          ForEach(state.controls.prefix(4), id: \.self) { LiveButton(action: $0, state: state) }
        }
      }
    }
    .padding(16)
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
        DynamicIslandExpandedRegion(.leading) {
          HStack(spacing: 6) {
            Image(systemName: s.symbol).foregroundStyle(s.accent)
            Text(s.title).font(.system(size: 13, weight: .medium)).lineLimit(1)
          }
        }
        DynamicIslandExpandedRegion(.trailing) {
          LiveClock(state: s, size: 22).foregroundStyle(s.resting ? s.accent : .white)
            .frame(maxWidth: 90, alignment: .trailing)
        }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(alignment: .leading, spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
              Text(s.step).font(.system(size: 16, weight: .semibold)).lineLimit(1)
              Text(s.detail).font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(1)
            }
            LiveProgress(state: s)
            if #available(iOS 17.0, *) {
              HStack(spacing: 8) {
                ForEach(s.controls.prefix(3), id: \.self) { LiveButton(action: $0, state: s) }
              }
            }
          }
        }
      } compactLeading: {
        Image(systemName: s.symbol).foregroundStyle(s.accent)
      } compactTrailing: {
        LiveClock(state: s, size: 14).foregroundStyle(s.resting ? s.accent : .white)
          .frame(maxWidth: 52)
      } minimal: {
        ZStack {
          RingView(value: s.progress, color: s.accent, width: 3)
          Image(systemName: s.symbol).font(.system(size: 10)).foregroundStyle(s.accent)
        }
      }
      .widgetURL(deepLink(s.href))
      .keylineTint(s.accent)
    }
  }
}
