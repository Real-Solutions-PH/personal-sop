import DeviceActivity
import Foundation

// Wakes when a Screen Time window starts or ends and when a group's usage
// crosses a rung, and appends one JSON line per callback to the App Group
// (ScreenTimeShared, Shared.swift). The app reads and reconciles them. No
// network and nothing else: the extension runs under a tight memory limit.
class DeviceActivityMonitorExtension: DeviceActivityMonitor {
  override func intervalDidStart(for activity: DeviceActivityName) {
    super.intervalDidStart(for: activity)
    guard let groupId = ScreenTimeShared.groupId(fromActivity: activity.rawValue) else { return }
    ScreenTimeShared.append([
      "kind": "start",
      "groupId": groupId,
      "at": ScreenTimeShared.nowMs(),
      "hasSelection": ScreenTimeShared.isObservable(groupId),
    ])
  }

  override func intervalDidEnd(for activity: DeviceActivityName) {
    super.intervalDidEnd(for: activity)
    guard let groupId = ScreenTimeShared.groupId(fromActivity: activity.rawValue) else { return }
    ScreenTimeShared.append([
      "kind": "end",
      "groupId": groupId,
      "at": ScreenTimeShared.nowMs(),
    ])
  }

  override func eventDidReachThreshold(
    _ event: DeviceActivityEvent.Name, activity: DeviceActivityName
  ) {
    super.eventDidReachThreshold(event, activity: activity)
    guard let groupId = ScreenTimeShared.groupId(fromActivity: activity.rawValue),
      let rungMin = ScreenTimeShared.rungMinutes(fromEvent: event.rawValue)
    else { return }
    ScreenTimeShared.append([
      "kind": "rung",
      "groupId": groupId,
      "at": ScreenTimeShared.nowMs(),
      "rungMin": rungMin,
    ])
  }
}
