import ExpoModulesCore
import Foundation
import ObjectiveC

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
      Self.send("setSnapshot:", json as NSString)
    }
    Function("setLive") { (json: String?) in
      Self.send("setLive:", json.map { $0 as NSString })
    }
    Function("drainActions") { () -> String in
      Self.string("drainActions", fallback: "[]")
    }
    Function("liveStatus") { () -> String in
      Self.string("liveStatus", fallback: #"{"enabled":false,"error":"no bridge"}"#)
    }
  }

  // Called through typed function pointers rather than `perform`, whose
  // untyped return reads garbage for a void method (and crashed the app).
  private typealias Send = @convention(c) (AnyObject, Selector, NSString?) -> Void
  private typealias Get = @convention(c) (AnyObject, Selector) -> Unmanaged<NSString>?

  /** The bridge's class method `name`, if the app target has it. */
  private static func method(_ name: String) -> (AnyObject, Selector, IMP)? {
    guard let cls = NSClassFromString("UnfurlSurfacesBridge") else { return nil }
    let sel = NSSelectorFromString(name)
    guard let m = class_getClassMethod(cls, sel) else { return nil }
    return (cls as AnyObject, sel, method_getImplementation(m))
  }

  private static func send(_ name: String, _ arg: NSString?) {
    guard let (cls, sel, imp) = method(name) else { return }
    unsafeBitCast(imp, to: Send.self)(cls, sel, arg)
  }

  /** A bridge class method that takes nothing and returns a string. */
  private static func string(_ name: String, fallback: String) -> String {
    guard let (cls, sel, imp) = method(name) else { return fallback }
    return (unsafeBitCast(imp, to: Get.self)(cls, sel)?.takeUnretainedValue() as String?) ?? fallback
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
