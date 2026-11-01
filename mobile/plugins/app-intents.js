// Puts Unfurl's App Intents and App Shortcuts (plugins/app-intents/) in the
// main app target only. Files in targets/widget/_shared go into the widget
// extension too, which would give the app two AppShortcutsProvider types and
// run intents meant for the app in the extension. The Swift is copied into
// the app's source folder at prebuild and added to the app target's sources.
const fs = require("node:fs")
const path = require("node:path")
const {
  IOSConfig,
  withDangerousMod,
  withXcodeProject,
} = require("expo/config-plugins")

const FILES = ["UnfurlAppIntents.swift"]
const SOURCE = path.join(__dirname, "app-intents")

const withCopy = (config) =>
  withDangerousMod(config, [
    "ios",
    (c) => {
      const name = IOSConfig.XcodeUtils.getProjectName(c.modRequest.projectRoot)
      const dest = path.join(c.modRequest.platformProjectRoot, name)
      for (const f of FILES)
        fs.copyFileSync(path.join(SOURCE, f), path.join(dest, f))
      return c
    },
  ])

const withSources = (config) =>
  withXcodeProject(config, (c) => {
    const project = c.modResults
    const name = IOSConfig.XcodeUtils.getProjectName(c.modRequest.projectRoot)
    // Named explicitly: the widget extension is a native target too.
    const app = IOSConfig.XcodeUtils.getApplicationNativeTarget({
      project,
      projectName: name,
    })
    for (const f of FILES) {
      const filepath = `${name}/${f}`
      if (project.hasFile(filepath)) continue
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
        filepath,
        groupName: name,
        project,
        targetUuid: app.uuid,
      })
    }
    return c
  })

module.exports = (config) => withSources(withCopy(config))
