import DeviceActivity
import ExpoModulesCore
import FamilyControls
import Foundation
import SwiftUI

// Screen Time for the JS side (src/prototype/screen-time.ts): permission,
// the app picker, and the daily DeviceActivity schedule whose threshold
// callbacks the activity-monitor extension writes to the App Group. Only
// linked when UNFURL_SCREEN_TIME=1 at prebuild (see app.config.js).

struct ScreenPlanItem: Record {
  @Field var groupId: String = ""
  @Field var kind: String = "custom"
  @Field var rungs: [Int] = []
}

public class UnfurlScreenTimeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("UnfurlScreenTime")

    AsyncFunction("authorizationStatus") { () -> String in
      Self.status()
    }

    AsyncFunction("requestAuthorization") { (promise: Promise) in
      guard #available(iOS 16.0, *) else { return promise.resolve("unavailable") }
      Task { @MainActor in
        // A refusal throws; the status below says which way it went.
        try? await AuthorizationCenter.shared.requestAuthorization(for: .individual)
        promise.resolve(Self.status())
      }
    }

    AsyncFunction("pickApps") { (groupId: String, promise: Promise) in
      guard #available(iOS 16.0, *) else { return promise.resolve(false) }
      let utilities = self.appContext?.utilities
      Task { @MainActor in
        guard let presenter = utilities?.currentViewController() else {
          return promise.resolve(false)
        }
        ScreenPicker.present(over: presenter, groupId: groupId) { promise.resolve($0) }
      }
    }

    AsyncFunction("hasSelection") { (groupId: String) -> Bool in
      ScreenTimeShared.defaults?.data(forKey: ScreenTimeShared.selectionKey(groupId)) != nil
    }

    AsyncFunction("startMonitoring") { (plan: [ScreenPlanItem], dayStartHour: Int) throws in
      guard #available(iOS 16.0, *) else { return }
      try Self.startMonitoring(plan, dayStartHour: dayStartHour)
    }

    AsyncFunction("stopMonitoring") { () in
      guard #available(iOS 16.0, *) else { return }
      DeviceActivityCenter().stopMonitoring()
    }

    AsyncFunction("readEvents") { () -> [String] in
      ScreenTimeShared.events()
    }
  }

  private static func status() -> String {
    guard #available(iOS 16.0, *) else { return "unavailable" }
    switch AuthorizationCenter.shared.authorizationStatus {
    case .notDetermined: return "notDetermined"
    case .denied: return "denied"
    // .approved, and iOS 26.4's .approvedWithDataAccess (named only from
    // that SDK on, so not matched by name here).
    default: return "approved"
    }
  }

  /** Replaces whatever was monitored with one daily activity per group,
   * dayStartHour:00 to one minute before it the next day, with an event per
   * rung. A custom group with no saved selection is still scheduled (its
   * start says hasSelection=false) but has no events: an event with an
   * empty selection would count every app. */
  @available(iOS 16.0, *)
  private static func startMonitoring(_ plan: [ScreenPlanItem], dayStartHour: Int) throws {
    let hour = ((dayStartHour % 24) + 24) % 24
    let schedule = DeviceActivitySchedule(
      intervalStart: DateComponents(hour: hour, minute: 0),
      intervalEnd: DateComponents(hour: (hour + 23) % 24, minute: 59),
      repeats: true
    )
    let center = DeviceActivityCenter()
    center.stopMonitoring()
    let defaults = ScreenTimeShared.defaults
    var failure: Error?
    for item in plan {
      defaults?.set(item.kind, forKey: ScreenTimeShared.kindKey(item.groupId))
      let selection: FamilyActivitySelection?
      if item.kind == "all" {
        selection = FamilyActivitySelection()
      } else {
        selection = ScreenPicker.load(item.groupId)
      }
      var events: [DeviceActivityEvent.Name: DeviceActivityEvent] = [:]
      if let selection {
        for minutes in Set(item.rungs) where minutes > 0 {
          events[DeviceActivityEvent.Name(ScreenTimeShared.rungName(minutes))] = event(
            selection, minutes: minutes)
        }
      }
      do {
        try center.startMonitoring(
          DeviceActivityName(ScreenTimeShared.activityName(item.groupId)),
          during: schedule,
          events: events
        )
      } catch {
        failure = failure ?? error
      }
    }
    if let failure { throw failure }
  }

  @available(iOS 16.0, *)
  private static func event(_ s: FamilyActivitySelection, minutes: Int) -> DeviceActivityEvent {
    let threshold = DateComponents(hour: minutes / 60, minute: minutes % 60)
    // Counting usage from earlier in the day needs iOS 17.4.
    if #available(iOS 17.4, *) {
      return DeviceActivityEvent(
        applications: s.applicationTokens,
        categories: s.categoryTokens,
        webDomains: s.webDomainTokens,
        threshold: threshold,
        includesPastActivity: true
      )
    }
    return DeviceActivityEvent(
      applications: s.applicationTokens,
      categories: s.categoryTokens,
      webDomains: s.webDomainTokens,
      threshold: threshold
    )
  }
}

// MARK: - The app picker

@available(iOS 16.0, *)
enum ScreenPicker {
  static func load(_ groupId: String) -> FamilyActivitySelection? {
    guard let data = ScreenTimeShared.defaults?.data(forKey: ScreenTimeShared.selectionKey(groupId))
    else { return nil }
    return try? PropertyListDecoder().decode(FamilyActivitySelection.self, from: data)
  }

  static func isEmpty(_ s: FamilyActivitySelection) -> Bool {
    s.applicationTokens.isEmpty && s.categoryTokens.isEmpty && s.webDomainTokens.isEmpty
  }

  /** Done saves the selection (an empty one clears it) and answers whether
   * one is saved; Cancel leaves the old selection and answers false. */
  @MainActor
  static func present(
    over presenter: UIViewController, groupId: String, done: @escaping (Bool) -> Void
  ) {
    let model = PickerModel(selection: load(groupId) ?? FamilyActivitySelection())
    let host = UIHostingController(rootView: PickerSheet(model: model))
    // Cancel or Done only: a swipe-down would leave the promise unanswered.
    host.isModalInPresentation = true
    model.finish = { [weak host] save in
      var saved = false
      if save {
        let key = ScreenTimeShared.selectionKey(groupId)
        if isEmpty(model.selection) {
          ScreenTimeShared.defaults?.removeObject(forKey: key)
        } else if let data = try? PropertyListEncoder().encode(model.selection) {
          ScreenTimeShared.defaults?.set(data, forKey: key)
          saved = true
        }
      }
      host?.dismiss(animated: true)
      done(saved)
    }
    presenter.present(host, animated: true)
  }
}

@available(iOS 16.0, *)
final class PickerModel: ObservableObject {
  @Published var selection: FamilyActivitySelection
  var finish: ((Bool) -> Void)?
  private var finished = false

  init(selection: FamilyActivitySelection) { self.selection = selection }

  func end(save: Bool) {
    guard !finished else { return }
    finished = true
    finish?(save)
  }
}

@available(iOS 16.0, *)
struct PickerSheet: View {
  @ObservedObject var model: PickerModel

  var body: some View {
    NavigationView {
      FamilyActivityPicker(selection: $model.selection)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
          ToolbarItem(placement: .cancellationAction) {
            Button("Cancel") { model.end(save: false) }
          }
          ToolbarItem(placement: .confirmationAction) {
            Button("Done") { model.end(save: true) }
          }
        }
    }
    .navigationViewStyle(.stack)
  }
}
