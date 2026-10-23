import ExpoModulesCore
import Foundation

// The JS side of ADR-0020 on iOS. The work happens in UnfurlSurfacesBridge
// (targets/widget/_shared/UnfurlShared.swift), which is compiled into the app
// target alongside the widget extension; this pod cannot import the app
// target, so it finds the bridge by its Objective-C name.

private let actionNotification = "com.schadenkai.personal-sop.surfaces.action"

public class UnfurlSurfacesModule: Module {
  private var observing = false

  public func definition() -> ModuleDefinition {
    Name("UnfurlSurfaces")
    Events("onAction")

    OnStartObserving {
      self.startObserving()
    }
    OnStopObserving {
      self.stopObserving()
    }
    OnDestroy {
      self.stopObserving()
    }

    Function("setSnapshot") { (json: String) in
      Self.call("setSnapshot:", json as NSString)
    }
    Function("setLive") { (json: String?) in
      Self.call("setLive:", json.map { $0 as NSString })
    }
    Function("drainActions") { () -> String in
      (Self.call("drainActions", nil) as? String) ?? "[]"
    }
  }

  @discardableResult
  private static func call(_ name: String, _ arg: NSString?) -> Any? {
    guard let bridge = NSClassFromString("UnfurlSurfacesBridge") as AnyObject? else { return nil }
    let sel = NSSelectorFromString(name)
    guard bridge.responds(to: sel) else { return nil }
    let out = arg == nil && !name.hasSuffix(":")
      ? bridge.perform(sel)
      : bridge.perform(sel, with: arg)
    return out?.takeUnretainedValue()
  }

  private func startObserving() {
    guard !observing else { return }
    observing = true
    CFNotificationCenterAddObserver(
      CFNotificationCenterGetDarwinNotifyCenter(),
      Unmanaged.passUnretained(self).toOpaque(),
      { _, observer, _, _, _ in
        guard let observer else { return }
        let module = Unmanaged<UnfurlSurfacesModule>.fromOpaque(observer).takeUnretainedValue()
        module.sendEvent("onAction", [:])
      },
      actionNotification as CFString, nil, .deliverImmediately)
  }

  private func stopObserving() {
    guard observing else { return }
    observing = false
    CFNotificationCenterRemoveObserver(
      CFNotificationCenterGetDarwinNotifyCenter(),
      Unmanaged.passUnretained(self).toOpaque(),
      CFNotificationName(actionNotification as CFString), nil)
  }
}
