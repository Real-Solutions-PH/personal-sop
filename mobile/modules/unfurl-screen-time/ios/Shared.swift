import Foundation

// What the app (UnfurlScreenTimeModule) and the activity-monitor extension
// share through the App Group. This one file is compiled into both: the
// extension's copy at targets/activity-monitor/Shared.swift is a symlink.
//
//   screen.selection.<groupId>  encoded FamilyActivitySelection (never empty)
//   screen.kind.<groupId>       "all" | "custom", written by startMonitoring
//   screen.events               [String], one JSON object per callback
//
// DeviceActivity names: activity "screen.<groupId>", event "rung.<minutes>".
enum ScreenTimeShared {
  static let suite = "group.com.schadenkai.personal-sop"
  static let eventsKey = "screen.events"
  static let maxEvents = 2000
  static let activityPrefix = "screen."
  static let rungPrefix = "rung."

  static var defaults: UserDefaults? { UserDefaults(suiteName: suite) }

  static func selectionKey(_ groupId: String) -> String { "screen.selection.\(groupId)" }
  static func kindKey(_ groupId: String) -> String { "screen.kind.\(groupId)" }

  static func activityName(_ groupId: String) -> String { activityPrefix + groupId }
  static func rungName(_ minutes: Int) -> String { rungPrefix + String(minutes) }

  /** The group of an activity this app named, or nil for any other. */
  static func groupId(fromActivity name: String) -> String? {
    name.hasPrefix(activityPrefix) ? String(name.dropFirst(activityPrefix.count)) : nil
  }

  static func rungMinutes(fromEvent name: String) -> Int? {
    name.hasPrefix(rungPrefix) ? Int(name.dropFirst(rungPrefix.count)) : nil
  }

  /** True when the group is monitored with something to count: "all" counts
   * every app; a custom group needs a saved (non-empty) selection. */
  static func isObservable(_ groupId: String) -> Bool {
    guard let d = defaults else { return false }
    if d.string(forKey: kindKey(groupId)) == "all" { return true }
    return d.data(forKey: selectionKey(groupId)) != nil
  }

  static func nowMs() -> Int64 { Int64((Date().timeIntervalSince1970 * 1000).rounded()) }

  /** Appends one event as a JSON line, keeping the newest `maxEvents`. */
  static func append(_ event: [String: Any]) {
    guard let d = defaults,
      let data = try? JSONSerialization.data(withJSONObject: event),
      let line = String(data: data, encoding: .utf8)
    else { return }
    var lines = d.stringArray(forKey: eventsKey) ?? []
    lines.append(line)
    if lines.count > maxEvents { lines.removeFirst(lines.count - maxEvents) }
    d.set(lines, forKey: eventsKey)
  }

  static func events() -> [String] { defaults?.stringArray(forKey: eventsKey) ?? [] }
}
