// Unfurl's App Intents and App Shortcuts: what shows up, with no setup, in
// the Shortcuts app, Spotlight, Siri, the Action button picker and the Back
// Tap list (Settings > Accessibility > Touch > Back Tap). Copied into the
// main app target by plugins/app-intents.js, never the widget extension, so
// there is one AppShortcutsProvider and every intent runs in the app's own
// process.
//
// Intents that change something hand the work to the app's JavaScript
// through ShortcutRequests (targets/widget/_shared/ShortcutRequests.swift),
// which calls the same store actions an in-app tap calls, so the change is
// saved locally and synced like any other. Marking a habit done reuses the
// widget's tap queue instead, which already works while the phone is locked.
// What's left today reads the snapshot the widgets read.

import AppIntents
import SwiftUI

// MARK: - Opening the app at Fern

/** Opens Fern already listening; the message sends when you stop talking.
 * The recommended Back Tap double tap. */
struct TalkToFernIntent: AppIntent {
  static let title: LocalizedStringResource = "Talk to Fern"
  static let description = IntentDescription("Opens Fern already listening. Stop talking and it sends.")
  static let openAppWhenRun: Bool = true

  @MainActor
  func perform() async throws -> some IntentResult {
    ShortcutRequests.open("/fern?mode=talk")
    return .result()
  }
}

/** Opens the camera straight into Fern: a meal, a receipt or a label. The
 * recommended Back Tap triple tap. */
struct SnapAndLogIntent: AppIntent {
  static let title: LocalizedStringResource = "Snap and log"
  static let description = IntentDescription("Opens the camera for Fern to log a meal, a receipt or a food label.")
  static let openAppWhenRun: Bool = true

  @MainActor
  func perform() async throws -> some IntentResult {
    ShortcutRequests.open("/fern?mode=camera")
    return .result()
  }
}

// MARK: - Ask Fern without opening the app

struct AskFernIntent: AppIntent {
  static let title: LocalizedStringResource = "Ask Fern"
  static let description = IntentDescription("Ask Fern anything or tell her what to log, and hear the answer without opening Unfurl.")
  static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

  @Parameter(title: "Question", requestValueDialog: "What do you want to ask Fern?")
  var question: String

  static var parameterSummary: some ParameterSummary {
    Summary("Ask Fern \(\.$question)")
  }

  func perform() async throws -> some IntentResult & ProvidesDialog & ShowsSnippetView {
    let text = question.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { throw $question.needsValueError("What do you want to ask Fern?") }
    guard let reply = await ShortcutRequests.ask("askFern", ["text": text], timeout: 25),
          reply["pending"] as? Bool != true else {
      // Not answered in time: the reply goes on in the app, or the question,
      // still queued, is asked as the app opens.
      throw needsToContinueInForegroundError("Fern is still on it. Open Unfurl to see her answer.") {
        ShortcutRequests.open("/fern?mode=chat")
      }
    }
    if let error = reply["error"] as? String { throw ShortcutError(error) }
    let answer = (reply["text"] as? String) ?? ""
    if reply["needsApp"] as? Bool == true {
      throw needsToContinueInForegroundError(
        IntentDialog(stringLiteral: answer.isEmpty ? "Fern needs you to confirm this in Unfurl." : "\(answer)\n\nConfirm it in Unfurl.")
      ) {
        ShortcutRequests.open("/fern?mode=chat")
      }
    }
    let shown = answer.isEmpty ? "Done." : answer
    return .result(dialog: IntentDialog(stringLiteral: shown), view: FernReplySnippet(text: shown))
  }
}

// MARK: - Quick expense

struct QuickExpenseIntent: AppIntent {
  static let title: LocalizedStringResource = "Log an expense"
  static let description = IntentDescription("Log spending like “₱250 lunch” without opening Unfurl, and see today's spend against your daily cap.")
  static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

  @Parameter(title: "Expense", requestValueDialog: "How much, and for what? Like “250 lunch”.")
  var expense: String

  static var parameterSummary: some ParameterSummary {
    Summary("Log \(\.$expense)")
  }

  func perform() async throws -> some IntentResult & ProvidesDialog & ShowsSnippetView {
    let text = expense.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { throw $expense.needsValueError("How much, and for what?") }
    guard let reply = await ShortcutRequests.ask("expense", ["text": text], timeout: 12) else {
      // Still queued: it is logged the moment the app next runs.
      throw needsToContinueInForegroundError("Open Unfurl to finish logging this.") {
        ShortcutRequests.open("/feature/finance")
      }
    }
    if let error = reply["error"] as? String { throw ShortcutError(error) }
    let spend = SpendSnippet.Info(reply)
    return .result(dialog: IntentDialog(stringLiteral: spend.sentence), view: SpendSnippet(data: spend))
  }
}

// MARK: - Mark a habit done

struct ShortcutHabit: Codable, Hashable {
  var id: String
  var name: String
  var icon: String
  /** Medicine, vitamins and the like, listed first. */
  var meds: Bool
  var done: Bool
}

/** The parts of the widget snapshot only the Shortcuts read (``shortcuts``
 * in src/surfaces/types.ts), decoded apart so WidgetSnapshot stays as the
 * widgets use it. */
struct ShortcutSnapshot: Decodable {
  struct Part: Decodable {
    var habits: [ShortcutHabit]
  }
  var day: String
  var dayEnds: String
  var at: String
  var shortcuts: Part?

  static func read() -> ShortcutSnapshot? {
    SharedStore.read("snapshot").flatMap { try? JSONDecoder().decode(ShortcutSnapshot.self, from: $0) }
  }
  /** The day it describes is still today. */
  var current: Bool { (UnfurlISO.date(dayEnds) ?? .distantPast) > Date() }
}

struct HabitEntity: AppEntity {
  static let typeDisplayRepresentation: TypeDisplayRepresentation = "Habit"
  static let defaultQuery = HabitQuery()

  var id: String
  var name: String
  var icon: String

  var displayRepresentation: DisplayRepresentation {
    DisplayRepresentation(title: "\(icon) \(name)")
  }

  init(_ h: ShortcutHabit) {
    id = h.id
    name = h.name
    icon = h.icon
  }
}

/** Today's due habits not yet done, medicine first: the list the app wrote
 * with the widget snapshot. */
struct HabitQuery: EntityQuery {
  /** Today's checkable habits, done or not. */
  static func today() -> [ShortcutHabit] {
    guard let snap = ShortcutSnapshot.read(), snap.current else { return [] }
    // A tick made here shows in the widget part before the app rewrites ours.
    let ticked = Set((SharedStore.snapshot()?.habits.items ?? []).filter(\.done).map(\.id))
    return (snap.shortcuts?.habits ?? []).map { h in
      var h = h
      if ticked.contains(h.id) { h.done = true }
      return h
    }
  }
  static func due() -> [HabitEntity] {
    today().filter { !$0.done }.map(HabitEntity.init)
  }
  func entities(for identifiers: [String]) async throws -> [HabitEntity] {
    Self.today().filter { identifiers.contains($0.id) }.map(HabitEntity.init)
  }
  func suggestedEntities() async throws -> [HabitEntity] {
    Self.due()
  }
}

struct MarkHabitDoneIntent: AppIntent {
  static let title: LocalizedStringResource = "Mark a habit done"
  static let description = IntentDescription("Tick off one of today's habits, like your vitamins, without opening Unfurl.")
  // Works from the Lock Screen: the tap is queued where the app picks it up.
  static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

  @Parameter(title: "Habit", requestValueDialog: "Which habit did you do?")
  var habit: HabitEntity

  static var parameterSummary: some ParameterSummary {
    Summary("Mark \(\.$habit) done")
  }

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let picked = habit
    guard HabitQuery.due().contains(where: { $0.id == picked.id }) else {
      return .result(dialog: IntentDialog(stringLiteral: "\(picked.name) is already done today."))
    }
    guard let snap = ShortcutSnapshot.read() else { throw ShortcutError("Open Unfurl once to load today's habits.") }
    if #available(iOS 17.0, *) {
      // The Habits widget's own tick: queued for the app, and the widgets
      // show it at once.
      _ = try await CheckHabitIntent(habitId: picked.id, day: snap.day).perform()
    } else {
      SurfaceTaps.queue(type: "checkHabit", kind: nil, target: picked.id, key: snap.day)
    }
    return .result(dialog: IntentDialog(stringLiteral: "\(picked.name) done. Nice."))
  }
}

// MARK: - Focus

enum FocusKind: String, AppEnum {
  case pomodoro
  case stopwatch

  static let typeDisplayRepresentation: TypeDisplayRepresentation = "Focus type"
  static let caseDisplayRepresentations: [FocusKind: DisplayRepresentation] = [
    .pomodoro: "Pomodoro (focus, then a break)",
    .stopwatch: "Stopwatch (open-ended)",
  ]
}

struct StartFocusIntent: AppIntent {
  static let title: LocalizedStringResource = "Start focus"
  static let description = IntentDescription("Start a focus session or Pomodoro. It shows on the Lock Screen while it runs.")
  static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

  @Parameter(title: "Type", description: "Leave empty to use your Focus settings.")
  var kind: FocusKind?

  static var parameterSummary: some ParameterSummary {
    Summary("Start \(\.$kind) focus")
  }

  func perform() async throws -> some IntentResult & ProvidesDialog {
    var fields: [String: Any] = [:]
    if let kind { fields["mode"] = kind.rawValue }
    guard let reply = await ShortcutRequests.ask("focusStart", fields, timeout: 10) else {
      throw needsToContinueInForegroundError("Open Unfurl to start your focus session.") {
        ShortcutRequests.open("/feature/focus")
      }
    }
    if let error = reply["error"] as? String { throw ShortcutError(error) }
    return .result(dialog: IntentDialog(stringLiteral: (reply["text"] as? String) ?? "Focus started."))
  }
}

struct StopFocusIntent: AppIntent {
  static let title: LocalizedStringResource = "Stop focus"
  static let description = IntentDescription("End the focus session that is running and keep the time you focused.")
  static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

  func perform() async throws -> some IntentResult & ProvidesDialog {
    guard let reply = await ShortcutRequests.ask("focusStop", [:], timeout: 10) else {
      throw needsToContinueInForegroundError("Open Unfurl to stop your focus session.") {
        ShortcutRequests.open("/feature/focus")
      }
    }
    if let error = reply["error"] as? String { throw ShortcutError(error) }
    return .result(dialog: IntentDialog(stringLiteral: (reply["text"] as? String) ?? "Focus stopped."))
  }
}

// MARK: - What's left today

struct WhatsLeftIntent: AppIntent {
  static let title: LocalizedStringResource = "What's left today"
  static let description = IntentDescription("Calories, protein, carbs and fat left today, and how much you can still spend.")
  static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

  func perform() async throws -> some IntentResult & ProvidesDialog & ShowsSnippetView {
    guard let snap = SharedStore.snapshot(), snap.dayEndsDate.map({ $0 > Date() }) == true else {
      throw needsToContinueInForegroundError("Open Unfurl once today so I can see your numbers.") {
        ShortcutRequests.open("/feature/today")
      }
    }
    let left = LeftSnippet.Info(snap)
    return .result(dialog: IntentDialog(stringLiteral: left.sentence), view: LeftSnippet(data: left))
  }
}

// MARK: - App Shortcuts

/** Siri only understands these in English (it has no Filipino). Every
 * phrase names the app, as Siri requires. */
struct UnfurlShortcuts: AppShortcutsProvider {
  static var shortcutTileColor: ShortcutTileColor = .lime

  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: TalkToFernIntent(),
      phrases: [
        "Talk to Fern in \(.applicationName)",
        "Talk to \(.applicationName)",
        "Open Fern in \(.applicationName)",
      ],
      shortTitle: "Talk to Fern",
      systemImageName: "waveform"
    )
    AppShortcut(
      intent: SnapAndLogIntent(),
      phrases: [
        "Snap and log in \(.applicationName)",
        "Log a photo in \(.applicationName)",
        "Scan a receipt in \(.applicationName)",
      ],
      shortTitle: "Snap and log",
      systemImageName: "camera"
    )
    AppShortcut(
      intent: AskFernIntent(),
      phrases: [
        "Ask Fern in \(.applicationName)",
        "Ask \(.applicationName)",
      ],
      shortTitle: "Ask Fern",
      systemImageName: "leaf"
    )
    AppShortcut(
      intent: QuickExpenseIntent(),
      phrases: [
        "Log an expense in \(.applicationName)",
        "Add spending in \(.applicationName)",
        "I spent money in \(.applicationName)",
      ],
      shortTitle: "Log expense",
      systemImageName: "pesosign.circle"
    )
    AppShortcut(
      intent: MarkHabitDoneIntent(),
      phrases: [
        "Mark a habit done in \(.applicationName)",
        "I took my meds in \(.applicationName)",
        "Check off a habit in \(.applicationName)",
      ],
      shortTitle: "Habit done",
      systemImageName: "checkmark.circle"
    )
    AppShortcut(
      intent: StartFocusIntent(),
      phrases: [
        "Start focus in \(.applicationName)",
        "Start a Pomodoro in \(.applicationName)",
      ],
      shortTitle: "Start focus",
      systemImageName: "timer"
    )
    AppShortcut(
      intent: StopFocusIntent(),
      phrases: [
        "Stop focus in \(.applicationName)",
        "End my focus in \(.applicationName)",
      ],
      shortTitle: "Stop focus",
      systemImageName: "stop.circle"
    )
    AppShortcut(
      intent: WhatsLeftIntent(),
      phrases: [
        "What's left today in \(.applicationName)",
        "How much is left in \(.applicationName)",
      ],
      shortTitle: "What's left",
      systemImageName: "chart.pie"
    )
  }
}

// MARK: - Errors and snippets

/** A reason shown to the person as is: the app writes these sentences. */
struct ShortcutError: Error, CustomLocalizedStringResourceConvertible {
  let message: String
  init(_ message: String) { self.message = message }
  var localizedStringResource: LocalizedStringResource { "\(message)" }
}

private enum SnippetTone {
  static let fern = Color(red: 0.18, green: 0.48, blue: 0.33)
  static let good = Color(red: 0.13, green: 0.55, blue: 0.33)
  static let over = Color(red: 0.80, green: 0.22, blue: 0.18)
}

struct FernReplySnippet: View {
  var text: String
  var body: some View {
    HStack(alignment: .top, spacing: 10) {
      Image(systemName: "leaf.fill")
        .font(.system(size: 15, weight: .semibold))
        .foregroundStyle(.white)
        .frame(width: 30, height: 30)
        .background(Circle().fill(SnippetTone.fern))
        .accessibilityHidden(true)
      Text(text)
        .font(.body)
        .frame(maxWidth: .infinity, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
    }
    .padding()
  }
}

/** Today's spend against the day's cap, drawn on one bar. */
struct SpendSnippet: View {
  struct Info {
    var logged: String
    var what: String
    var spentToday: String
    var cap: String?
    var share: Double
    var over: Bool
    var hidden: Bool

    init(_ r: [String: Any]) {
      logged = r["amount"] as? String ?? ""
      what = r["what"] as? String ?? ""
      spentToday = r["spentToday"] as? String ?? ""
      cap = r["cap"] as? String
      share = r["share"] as? Double ?? 0
      over = r["over"] as? Bool ?? false
      hidden = r["hidden"] as? Bool ?? false
    }

    var sentence: String {
      let head = "Logged \(logged)\(what.isEmpty ? "" : " for \(what)")."
      if hidden { return head }
      guard let cap else { return "\(head) You've spent \(spentToday) today." }
      return over
        ? "\(head) That's \(spentToday) today, over your \(cap) for the day."
        : "\(head) \(spentToday) of \(cap) spent today."
    }
  }

  var data: Info
  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .firstTextBaseline) {
        Text(data.logged).font(.title2.weight(.semibold)).monospacedDigit()
        if !data.what.isEmpty {
          Text(data.what).font(.body).foregroundStyle(.secondary).lineLimit(2)
        }
        Spacer(minLength: 0)
      }
      if !data.hidden {
        if let cap = data.cap {
          HStack {
            Text("Today").font(.subheadline).foregroundStyle(.secondary)
            Spacer()
            Text("\(data.spentToday) of \(cap)")
              .font(.subheadline.weight(.medium))
              .monospacedDigit()
              .foregroundStyle(data.over ? SnippetTone.over : .primary)
          }
          GeometryReader { g in
            ZStack(alignment: .leading) {
              Capsule().fill(Color.secondary.opacity(0.2))
              Capsule()
                .fill(data.over ? SnippetTone.over : SnippetTone.good)
                .frame(width: g.size.width * min(1, max(0.02, data.share)))
            }
          }
          .frame(height: 8)
          .accessibilityHidden(true)
        } else {
          Text("\(data.spentToday) spent today").font(.subheadline).foregroundStyle(.secondary).monospacedDigit()
        }
      }
    }
    .padding()
  }
}

/** Macros and money left today, from the widget snapshot. */
struct LeftSnippet: View {
  struct Row: Identifiable {
    var id: String { label }
    var label: String
    var left: String
    var share: Double
    var tone: Color
  }
  struct Info {
    var rows: [Row] = []
    var money: (left: String, today: String, hidden: Bool)?
    var updated: Date?
    var sentence = ""

    init(_ s: WidgetSnapshot) {
      updated = UnfurlISO.date(s.at)
      var said: [String] = []
      if let m = s.macros {
        func row(_ label: String, _ x: WidgetMacro, _ unit: String, _ tone: Color) -> Row {
          Row(label: label, left: "\(Int(x.left.rounded()).formatted())\(unit) left", share: x.share, tone: tone)
        }
        rows = [
          row("Calories", m.kcal, "", Color.orange),
          row("Protein", m.protein, " g", SnippetTone.fern),
          row("Carbs", m.carbs, " g", Color.blue),
          row("Fat", m.fat, " g", Color.pink),
        ]
        said.append("\(Int(m.kcal.left.rounded()).formatted()) calories and \(Int(m.protein.left.rounded()).formatted()) g protein left")
      }
      if let m = s.money {
        money = (m.left, m.safeToday, m.hidden)
        if !m.hidden { said.append("\(m.safeToday) safe to spend today") }
      }
      sentence = said.isEmpty
        ? "Set a calorie target or a budget in Unfurl to see what's left."
        : said.joined(separator: ", and ") + "."
    }
  }

  var data: Info
  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      ForEach(data.rows) { r in
        VStack(alignment: .leading, spacing: 4) {
          HStack {
            Text(r.label).font(.subheadline).foregroundStyle(.secondary)
            Spacer()
            Text(r.left).font(.subheadline.weight(.medium)).monospacedDigit()
          }
          GeometryReader { g in
            ZStack(alignment: .leading) {
              Capsule().fill(Color.secondary.opacity(0.2))
              Capsule().fill(r.tone).frame(width: g.size.width * min(1, max(0.02, r.share)))
            }
          }
          .frame(height: 6)
          .accessibilityHidden(true)
        }
      }
      if let m = data.money, !m.hidden {
        HStack(alignment: .firstTextBaseline) {
          Text("Safe to spend today").font(.subheadline).foregroundStyle(.secondary)
          Spacer()
          Text(m.today).font(.title3.weight(.semibold)).monospacedDigit()
        }
        Text("\(m.left) left this month").font(.footnote).foregroundStyle(.secondary).monospacedDigit()
      }
      if let at = data.updated {
        Text("As of \(at.formatted(date: .omitted, time: .shortened))").font(.caption2).foregroundStyle(.tertiary)
      }
    }
    .padding()
  }
}
