import Intents
import UserNotifications

/// Shows Fern in Fern's own pushes (see expo-target.config.js).
///
/// A push from Fern carries `fern` (the companion's current name) in the data
/// Expo nests under `body`. It is shown as a message from Fern, with Fern's
/// picture as the sender (a communication notification), when the app holds
/// the Communication Notifications capability; otherwise, and on any error,
/// with Fern's picture attached. Every other push is passed through as is.
class NotificationService: UNNotificationServiceExtension {
  private var contentHandler: ((UNNotificationContent) -> Void)?
  private var fallback: UNNotificationContent?

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    self.contentHandler = contentHandler
    fallback = request.content
    guard
      let sender = Self.fernName(request.content.userInfo),
      let content = request.content.mutableCopy() as? UNMutableNotificationContent
    else {
      deliver(request.content)
      return
    }
    if let attachment = Self.fernAttachment() {
      content.attachments = [attachment]
    }
    fallback = content
    guard let avatar = Self.fernImage() else {
      deliver(content)
      return
    }
    let fern = INPerson(
      personHandle: INPersonHandle(value: "fern", type: .unknown),
      nameComponents: nil,
      displayName: sender,
      image: avatar,
      contactIdentifier: nil,
      customIdentifier: "fern"
    )
    let intent = INSendMessageIntent(
      recipients: nil,
      outgoingMessageType: .outgoingMessageText,
      content: content.body,
      speakableGroupName: nil,
      conversationIdentifier: "fern",
      serviceName: nil,
      sender: fern,
      attachments: nil
    )
    intent.setImage(avatar, forParameterNamed: \.sender)
    let interaction = INInteraction(intent: intent, response: nil)
    interaction.direction = .incoming
    interaction.donate { [weak self] _ in
      // Without the capability (or on any error) the attachment is kept.
      let styled = try? content.updating(from: intent)
      self?.deliver(styled ?? content)
    }
  }

  override func serviceExtensionTimeWillExpire() {
    if let fallback { deliver(fallback) }
  }

  private func deliver(_ content: UNNotificationContent) {
    guard let handler = contentHandler else { return }
    contentHandler = nil
    handler(content)
  }

  /// The sender's name when the push is from Fern.
  static func fernName(_ userInfo: [AnyHashable: Any]) -> String? {
    let data = userInfo["body"] as? [String: Any] ?? [:]
    guard let name = data["fern"] as? String else { return nil }
    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? "Fern" : trimmed
  }

  private static var fernURL: URL? {
    Bundle(for: NotificationService.self).url(forResource: "fern", withExtension: "png")
  }

  static func fernImage() -> INImage? {
    guard let url = fernURL, let data = try? Data(contentsOf: url) else { return nil }
    return INImage(imageData: data)
  }

  /// The bundled picture as an attachment: iOS moves an attachment's file
  /// into its own store, so it gets a copy, never the bundle's file.
  static func fernAttachment() -> UNNotificationAttachment? {
    guard let url = fernURL else { return nil }
    let copy = FileManager.default.temporaryDirectory
      .appendingPathComponent("fern-\(UUID().uuidString).png")
    do {
      try FileManager.default.copyItem(at: url, to: copy)
      return try UNNotificationAttachment(identifier: "fern", url: copy, options: nil)
    } catch {
      return nil
    }
  }
}
