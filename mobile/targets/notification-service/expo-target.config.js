// Fern in the notification: a Notification Service Extension that edits a
// remote push before iOS shows it. The server marks Fern's pushes (retention
// nudges, "Fern replied") with `data.fern` (the companion's current name) and
// `mutableContent`; this extension then shows them as a message from Fern,
// with Fern's picture as the sender (a communication notification), or, where
// that is not allowed, with the picture attached. Every other push passes
// through unchanged. Built by @bacons/apple-targets at prebuild, so it ships
// with the next native build; a build without it shows the plain push.

/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = () => ({
  type: "notification-service",
  name: "NotificationService",
  bundleIdentifier: ".notification-service",
  // UNNotificationContent.updating(from:) (communication notifications).
  deploymentTarget: "15.0",
  frameworks: ["UserNotifications", "Intents"],
})
