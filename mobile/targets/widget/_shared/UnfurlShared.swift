// Compiled into BOTH the app and the widget extension (@bacons/apple-targets
// links targets/widget/_shared into the main target too). It holds what the
// two processes share: the data shapes the app writes (mirroring
// mobile/src/surfaces/types.ts), the shared keychain store, the queue of
// lock-screen taps, and the App Intents behind the Live Activity buttons.
// ADR-0020 explains the choices.

import ActivityKit
import AppIntents
import Foundation
import Security
import WidgetKit

// MARK: - Shapes (keep in step with src/surfaces/types.ts)

struct WidgetHabit: Codable, Hashable {
  var id: String
  var name: String
  var icon: String
  var streak: Int
  var done: Bool
  var time: String?
  var checkable: Bool
}

struct WidgetTask: Codable, Hashable {
  var id: String
  var title: String
  var when: String
  var overdue: Bool
}

struct WidgetMacro: Codable, Hashable {
  var eaten: Double
  var target: Double
  var left: Double { max(0, target - eaten) }
  var share: Double { target > 0 ? min(1, eaten / target) : 0 }
}

struct WidgetSnapshot: Codable {
  struct Today: Codable {
    var done: Int
    var due: Int
    var pct: Double
    var target: Double
    var headline: String
    var lifeScore: Int?
    var streak: Int
  }
  struct Habits: Codable {
    var done: Int
    var total: Int
    var items: [WidgetHabit]
  }
  struct Macros: Codable {
    var kcal: WidgetMacro
    var protein: WidgetMacro
    var carbs: WidgetMacro
    var fat: WidgetMacro
    var meals: Int
  }
  struct Tasks: Codable {
    var open: Int
    var overdue: Int
    var items: [WidgetTask]
  }
  struct Money: Codable {
    var safeToday: String
    var left: String
    var spent: String
    var limit: String
    var pct: Double
    var daysLeft: Double
    var hidden: Bool
  }
  struct Live: Codable {
    var kind: String
    var title: String
    var href: String
  }
  var v: Int
  var at: String
  var day: String
  var dayEnds: String
  var today: Today
  var habits: Habits
  var macros: Macros?
  var tasks: Tasks
  var money: Money?
  var live: Live?

  var dayEndsDate: Date? { UnfurlISO.date(dayEnds) }
}

struct LiveNext: Codable, Hashable {
  var key: String
  var label: String
  var detail: String
  var sec: Double?
}

/** The running routine, workout or habit timer (LiveState in TS). Times are
 * epoch milliseconds. */
struct LiveState: Codable, Hashable {
  var kind: String
  var id: String
  var title: String
  var icon: String
  var step: String
  var detail: String
  var key: String
  var index: Int
  var count: Int
  var paused: Bool
  var startedAt: Double
  var elapsedSec: Double
  var stepEndsAt: Double?
  var remainingSec: Double?
  var restEndsAt: Double?
  var restSec: Double
  var next: [LiveNext]
  var controls: [String]
  var href: String

  var startDate: Date { Date(timeIntervalSince1970: startedAt / 1000) }
  var stepEnd: Date? { stepEndsAt.map { Date(timeIntervalSince1970: $0 / 1000) } }
  var restEnd: Date? { restEndsAt.map { Date(timeIntervalSince1970: $0 / 1000) } }
  var resting: Bool { (restEndsAt ?? 0) > Date().timeIntervalSince1970 * 1000 }
  var progress: Double { count > 0 ? min(1, Double(index) / Double(count)) : 0 }

  /** The state right after a lock-screen tap, before the app has run: the
   * app recomputes and replaces it once it applies the queued action. Nil
   * means the activity ends. */
  func applying(_ type: String, now: Double = Date().timeIntervalSince1970 * 1000) -> LiveState? {
    var s = self
    func swap(_ from: String, _ to: String) {
      s.controls = s.controls.map { $0 == from ? to : $0 }
    }
    switch type {
    case "done", "skip":
      guard !s.next.isEmpty else { return nil }
      let n = s.next.removeFirst()
      s.step = n.label
      s.detail = n.detail
      s.key = n.key
      s.index += 1
      s.paused = false
      s.remainingSec = nil
      s.stepEndsAt = n.sec.map { now + $0 * 1000 }
      swap("resume", "pause")
    case "pause":
      guard !s.paused else { return s }
      s.paused = true
      s.elapsedSec = max(0, (now - s.startedAt) / 1000)
      if let end = s.stepEndsAt { s.remainingSec = max(0, (end - now) / 1000) }
      s.stepEndsAt = nil
      swap("pause", "resume")
    case "resume":
      guard s.paused else { return s }
      s.paused = false
      if let rem = s.remainingSec { s.stepEndsAt = now + rem * 1000 }
      s.remainingSec = nil
      if s.kind == "timer" { s.startedAt = now - s.elapsedSec * 1000 }
      swap("resume", "pause")
    case "finishSet":
      s.index = min(s.count, s.index + 1)
      if s.next.isEmpty {
        s.step = "All sets done"
        s.detail = "Finish when you're ready"
        s.key = ""
      } else {
        let n = s.next.removeFirst()
        s.step = n.label
        s.detail = n.detail
        s.key = n.key
      }
      if s.restSec > 0 { s.restEndsAt = now + s.restSec * 1000 }
      s.controls = (s.key.isEmpty ? [] : ["finishSet"])
        + (s.restEndsAt != nil ? ["skipRest", "addRest"] : []) + ["finish"]
    case "skipRest":
      s.restEndsAt = nil
      s.controls = s.controls.filter { $0 != "skipRest" && $0 != "addRest" }
    case "addRest":
      if let end = s.restEndsAt { s.restEndsAt = end + 30_000 }
    case "finish":
      return nil
    default:
      break
    }
    return s
  }
}

@available(iOS 16.1, *)
struct UnfurlActivityAttributes: ActivityAttributes {
  typealias ContentState = LiveState
  /** "routine" | "workout" | "timer" */
  var kind: String
  /** Run, workout or habit id. */
  var id: String
}

enum UnfurlISO {
  private static let withFraction: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
  }()
  private static let plain = ISO8601DateFormatter()
  static func date(_ s: String) -> Date? { withFraction.date(from: s) ?? plain.date(from: s) }
}

// MARK: - Shared store

/** A keychain item both processes can read: the app's free (personal) Apple
 * team cannot sign an App Group, but it can sign a keychain access group
 * under its own team prefix. Without the Info.plist key (a build without the
 * entitlement) it falls back to UserDefaults, which only the app sees. */
enum SharedStore {
  private static let service = "unfurl.surfaces"
  static var group: String? {
    let g = Bundle.main.object(forInfoDictionaryKey: "UnfurlKeychainGroup") as? String
    return (g?.isEmpty == false && g?.hasPrefix("$(") == false) ? g : nil
  }
  private static func query(_ key: String) -> [String: Any] {
    var q: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: key,
    ]
    if let group { q[kSecAttrAccessGroup as String] = group }
    return q
  }
  static func read(_ key: String) -> Data? {
    guard group != nil else { return UserDefaults.standard.data(forKey: "\(service).\(key)") }
    var q = query(key)
    q[kSecReturnData as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    var out: AnyObject?
    return SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess ? out as? Data : nil
  }
  static func write(_ key: String, _ data: Data) {
    guard group != nil else {
      UserDefaults.standard.set(data, forKey: "\(service).\(key)")
      return
    }
    let attrs: [String: Any] = [
      kSecValueData as String: data,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
    ]
    let status = SecItemUpdate(query(key) as CFDictionary, attrs as CFDictionary)
    if status == errSecItemNotFound {
      var add = query(key)
      add.merge(attrs) { $1 }
      SecItemAdd(add as CFDictionary, nil)
    }
  }

  static func remove(_ key: String) {
    guard group != nil else {
      UserDefaults.standard.removeObject(forKey: "\(service).\(key)")
      return
    }
    SecItemDelete(query(key) as CFDictionary)
  }

  static func snapshot() -> WidgetSnapshot? {
    guard let data = read("snapshot") else { return nil }
    return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
  }
  static func saveSnapshot(_ s: WidgetSnapshot) {
    if let data = try? JSONEncoder().encode(s) { write("snapshot", data) }
  }

  // Taps waiting for the app, oldest first.
  private static let lock = NSLock()
  static func enqueue(_ action: [String: Any]) {
    lock.lock()
    defer { lock.unlock() }
    var list = (read("actions").flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [[String: Any]]) ?? []
    list.append(action)
    if list.count > 200 { list.removeFirst(list.count - 200) }
    if let data = try? JSONSerialization.data(withJSONObject: list) { write("actions", data) }
  }
  static func drain() -> String {
    lock.lock()
    defer { lock.unlock() }
    let data = read("actions") ?? Data("[]".utf8)
    write("actions", Data("[]".utf8))
    return String(data: data, encoding: .utf8) ?? "[]"
  }
}

// MARK: - Taps

/** The Darwin notification the app's module listens for: a tap was queued
 * (by the app process or the widget process). */
let unfurlActionNotification = "com.schadenkai.personal-sop.surfaces.action"

enum SurfaceTaps {
  static func queue(type: String, kind: String?, target: String, key: String?) {
    var a: [String: Any] = [
      "id": UUID().uuidString,
      "type": type,
      "target": target,
      "at": (Date().timeIntervalSince1970 * 1000).rounded(),
    ]
    if let kind, !kind.isEmpty { a["kind"] = kind }
    if let key, !key.isEmpty { a["key"] = key }
    SharedStore.enqueue(a)
    CFNotificationCenterPostNotification(
      CFNotificationCenterGetDarwinNotifyCenter(),
      CFNotificationName(unfurlActionNotification as CFString), nil, nil, true)
  }

  /** Moves the lock-screen activity on at once, so the tap feels immediate
   * even while the app is still starting. */
  @available(iOS 16.2, *)
  static func advanceActivity(type: String, target: String, key: String?) async {
    for activity in Activity<UnfurlActivityAttributes>.activities where activity.attributes.id == target {
      let current = activity.content.state
      // A second tap on an already-advanced step changes nothing.
      if let key, !key.isEmpty, ["done", "skip", "finishSet"].contains(type), key != current.key { continue }
      if let next = current.applying(type) {
        await activity.update(ActivityContent(state: next, staleDate: nil))
      } else {
        await activity.end(ActivityContent(state: current, staleDate: nil), dismissalPolicy: .immediate)
      }
    }
  }
}

/** A button on the Live Activity or Dynamic Island. As a LiveActivityIntent
 * the system runs it in the app's process (launching the app in the
 * background when it was closed), so the app applies the tap to its stores
 * and syncs it like any other change. */
@available(iOS 17.0, *)
struct LiveControlIntent: LiveActivityIntent {
  static let title: LocalizedStringResource = "Control the running activity"
  static let isDiscoverable: Bool = false

  @Parameter(title: "Action") var action: String
  @Parameter(title: "Kind") var kind: String
  @Parameter(title: "Target") var target: String
  @Parameter(title: "Key") var key: String

  init() {}
  init(_ action: String, state: LiveState) {
    self.action = action
    self.kind = state.kind
    self.target = state.id
    self.key = state.key
  }

  func perform() async throws -> some IntentResult {
    SurfaceTaps.queue(type: action, kind: kind, target: target, key: key)
    await SurfaceTaps.advanceActivity(type: action, target: target, key: key)
    return .result()
  }
}

/** The tick on a habit in the Habits widget. Declared a LiveActivityIntent
 * (not a plain AppIntent) so it, too, runs in the app's process and reaches
 * the stores without waiting for the next launch. */
@available(iOS 17.0, *)
struct CheckHabitIntent: LiveActivityIntent {
  static let title: LocalizedStringResource = "Check a habit"
  static let isDiscoverable: Bool = false

  @Parameter(title: "Habit") var habitId: String
  @Parameter(title: "Day") var day: String

  init() {}
  init(habitId: String, day: String) {
    self.habitId = habitId
    self.day = day
  }

  func perform() async throws -> some IntentResult {
    SurfaceTaps.queue(type: "checkHabit", kind: nil, target: habitId, key: day)
    if var snap = SharedStore.snapshot(), snap.day == day,
       let i = snap.habits.items.firstIndex(where: { $0.id == habitId }), !snap.habits.items[i].done {
      snap.habits.items[i].done = true
      snap.habits.items[i].streak += 1
      snap.habits.done += 1
      SharedStore.saveSnapshot(snap)
    }
    WidgetCenter.shared.reloadAllTimelines()
    return .result()
  }
}

// MARK: - App side

/** What the app's Expo module (modules/unfurl-surfaces) calls, found by name
 * at runtime because the module's pod cannot see the app target's types. */
@objc(UnfurlSurfacesBridge)
public final class UnfurlSurfacesBridge: NSObject {
  @objc public static func setSnapshot(_ json: NSString) {
    if json.length == 0 {
      SharedStore.remove("snapshot")
    } else {
      SharedStore.write("snapshot", Data((json as String).utf8))
    }
    WidgetCenter.shared.reloadAllTimelines()
  }

  @objc public static func drainActions() -> NSString {
    SharedStore.drain() as NSString
  }

  @objc public static func setLive(_ json: NSString?) {
    let state = json.flatMap { try? JSONDecoder().decode(LiveState.self, from: Data(($0 as String).utf8)) }
    guard #available(iOS 16.2, *) else { return }
    Task { await LiveActivities.show(state) }
  }
}

@available(iOS 16.2, *)
enum LiveActivities {
  static func show(_ state: LiveState?) async {
    let running = Activity<UnfurlActivityAttributes>.activities
    guard let state else {
      for a in running { await a.end(nil, dismissalPolicy: .immediate) }
      return
    }
    var updated = false
    for a in running {
      if a.attributes.id == state.id && a.attributes.kind == state.kind && !updated {
        await a.update(ActivityContent(state: state, staleDate: nil))
        updated = true
      } else {
        await a.end(nil, dismissalPolicy: .immediate)
      }
    }
    guard !updated, ActivityAuthorizationInfo().areActivitiesEnabled else { return }
    _ = try? Activity.request(
      attributes: UnfurlActivityAttributes(kind: state.kind, id: state.id),
      content: ActivityContent(state: state, staleDate: nil),
      pushType: nil)
  }
}
