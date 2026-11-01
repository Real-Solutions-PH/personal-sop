// The way a Shortcut, Siri or Back Tap hands work to the app's JavaScript
// (src/surfaces/requests.ts) and waits for the answer. Compiled into both
// targets like the rest of _shared, but only the app's intents
// (plugins/app-intents/UnfurlAppIntents.swift) use it: they run in the app's
// process, so the request reaches the same stores, outbox and sync as a tap
// inside the app.
//
// A request is queued in the shared store and announced with the same
// Darwin notification as a lock-screen tap. The app drains the queue when it
// mounts, when it comes to the foreground and on that notification, then
// writes a reply under the request's id. A request nobody answered in time
// stays queued, so it still runs the next time the app opens.

import Foundation

enum ShortcutRequests {
  private static let lock = NSLock()
  private static let queueKey = "requests"
  private static let repliesKey = "replies"
  /** Replies kept for intents still waiting; older ones are dropped. */
  private static let keepReplies = 20

  private static func list(_ key: String) -> [[String: Any]] {
    (SharedStore.read(key).flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [[String: Any]]) ?? []
  }
  private static func save(_ key: String, _ list: [[String: Any]]) {
    if let data = try? JSONSerialization.data(withJSONObject: list) { SharedStore.write(key, data) }
  }

  private static func announce() {
    CFNotificationCenterPostNotification(
      CFNotificationCenterGetDarwinNotifyCenter(),
      CFNotificationName(unfurlActionNotification as CFString), nil, nil, true)
  }

  /** Queues a request and returns its id. */
  @discardableResult
  static func enqueue(_ type: String, _ fields: [String: Any] = [:]) -> String {
    let id = UUID().uuidString
    var r = fields
    r["id"] = id
    r["type"] = type
    r["at"] = (Date().timeIntervalSince1970 * 1000).rounded()
    lock.lock()
    var queue = list(queueKey)
    queue.append(r)
    if queue.count > 50 { queue.removeFirst(queue.count - 50) }
    save(queueKey, queue)
    lock.unlock()
    announce()
    return id
  }

  /** Asks the app to show a screen: a widget-style deep link path such as
   * "/fern?mode=talk" (src/surfaces/links.ts). */
  static func open(_ path: String) {
    enqueue("open", ["path": path])
  }

  /** Queues a request and waits for the app's reply; nil when none came in
   * time (the request stays queued for the next launch). */
  static func ask(_ type: String, _ fields: [String: Any] = [:], timeout: TimeInterval) async -> [String: Any]? {
    let id = enqueue(type, fields)
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      if let reply = take(id) { return reply }
      try? await Task.sleep(nanoseconds: 200_000_000)
    }
    return take(id)
  }

  private static func take(_ id: String) -> [String: Any]? {
    lock.lock()
    defer { lock.unlock() }
    var replies = list(repliesKey)
    guard let i = replies.firstIndex(where: { $0["id"] as? String == id }) else { return nil }
    let r = replies.remove(at: i)
    save(repliesKey, replies)
    return r["reply"] as? [String: Any]
  }

  static func drain() -> String {
    lock.lock()
    defer { lock.unlock() }
    let data = SharedStore.read(queueKey) ?? Data("[]".utf8)
    SharedStore.write(queueKey, Data("[]".utf8))
    return String(data: data, encoding: .utf8) ?? "[]"
  }

  static func reply(_ id: String, _ json: String) {
    guard let reply = try? JSONSerialization.jsonObject(with: Data(json.utf8)) else { return }
    lock.lock()
    defer { lock.unlock() }
    var replies = list(repliesKey)
    replies.append(["id": id, "reply": reply])
    if replies.count > keepReplies { replies.removeFirst(replies.count - keepReplies) }
    save(repliesKey, replies)
  }
}

/** What the app's Expo module calls for requests, found by name like
 * UnfurlSurfacesBridge. */
@objc(UnfurlRequestsBridge)
public final class UnfurlRequestsBridge: NSObject {
  @objc public static func drainRequests() -> NSString {
    ShortcutRequests.drain() as NSString
  }

  /** ``payload`` is "<id>\n<reply JSON>": the module's typed call passes
   * one string. */
  @objc public static func reply(_ payload: NSString) {
    let s = payload as String
    guard let cut = s.firstIndex(of: "\n") else { return }
    ShortcutRequests.reply(String(s[..<cut]), String(s[s.index(after: cut)...]))
  }
}
