/**
 * Adds the OpennibKeyboard custom keyboard extension target to the Xcode project.
 *
 * Source files live at <project>/ios-keyboard/. We copy them into ios/OpennibKeyboard/
 * during prebuild and register a new PBXNativeTarget of type
 * com.apple.product-type.app-extension. xcode npm pkg's addTarget('app_extension')
 * auto-creates the embed copy-files phase on the main target.
 *
 * Idempotent: re-running this plugin (e.g. after expo prebuild) skips work
 * once the target already exists.
 */
const { withXcodeProject, withDangerousMod } = require("@expo/config-plugins")
const fs = require("fs")
const path = require("path")

const KEYBOARD_TARGET_NAME = "OpennibKeyboard"
const KEYBOARD_BUNDLE_ID = "com.opennib.mobile.keyboard"
const APP_GROUP = "group.com.opennib.mobile"
const DEPLOYMENT_TARGET = "17.0"

const withCopyKeyboardSources = (config) =>
  withDangerousMod(config, [
    "ios",
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot
      const platformRoot = cfg.modRequest.platformProjectRoot // ios/
      const src = path.join(projectRoot, "ios-keyboard")
      const dst = path.join(platformRoot, KEYBOARD_TARGET_NAME)
      if (!fs.existsSync(src)) {
        throw new Error(`with-keyboard-extension: ${src} not found`)
      }
      fs.mkdirSync(dst, { recursive: true })
      for (const file of ["KeyboardViewController.swift", "Info.plist"]) {
        const from = path.join(src, file)
        const to = path.join(dst, file)
        if (!fs.existsSync(from)) {
          throw new Error(`with-keyboard-extension: missing ${from}`)
        }
        fs.copyFileSync(from, to)
      }
      const entitlements = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.application-groups</key>
  <array>
    <string>${APP_GROUP}</string>
  </array>
</dict>
</plist>
`
      fs.writeFileSync(path.join(dst, `${KEYBOARD_TARGET_NAME}.entitlements`), entitlements)
      return cfg
    },
  ])

const withRegisterKeyboardTarget = (config) =>
  withXcodeProject(config, async (cfg) => {
    const project = cfg.modResults

    // Idempotency: bail if the target already exists.
    const targets = project.pbxNativeTargetSection()
    for (const key of Object.keys(targets)) {
      if (key.endsWith("_comment")) continue
      const t = targets[key]
      if (t && (t.name === KEYBOARD_TARGET_NAME || t.name === `"${KEYBOARD_TARGET_NAME}"`)) {
        return cfg
      }
    }

    // Create a PBXGroup for the extension's source files. Keep pathName undefined so
    // that file refs inside (which already carry "OpennibKeyboard/" in their path) don't
    // get double-prefixed when Xcode resolves them.
    const groupKey = project.pbxCreateGroup(KEYBOARD_TARGET_NAME)
    const mainGroupKey = project.getFirstProject().firstProject.mainGroup
    const mainGroup = project.getPBXGroupByKey(mainGroupKey)
    mainGroup.children.push({ value: groupKey, comment: KEYBOARD_TARGET_NAME })

    // Add Info.plist and entitlements as plain file refs on the group (not in any build phase).
    project.addFile(`${KEYBOARD_TARGET_NAME}/Info.plist`, groupKey)
    project.addFile(`${KEYBOARD_TARGET_NAME}/${KEYBOARD_TARGET_NAME}.entitlements`, groupKey)

    // Create the new app-extension target. This auto-creates the embed copy-files phase on the main target.
    const target = project.addTarget(
      KEYBOARD_TARGET_NAME,
      "app_extension",
      KEYBOARD_TARGET_NAME,
      KEYBOARD_BUNDLE_ID,
    )

    // The new target needs Sources/Frameworks/Resources build phases.
    project.addBuildPhase([], "PBXSourcesBuildPhase", "Sources", target.uuid)
    project.addBuildPhase([], "PBXResourcesBuildPhase", "Resources", target.uuid)
    project.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", target.uuid)

    // Add the swift source: registers in PBXFileReference, PBXBuildFile, PBXGroup, and the matching Sources phase.
    project.addSourceFile(
      `${KEYBOARD_TARGET_NAME}/KeyboardViewController.swift`,
      { target: target.uuid },
      groupKey,
    )

    // Build settings — the new target's two XCBuildConfiguration entries are identifiable
    // by PRODUCT_NAME == KEYBOARD_TARGET_NAME (set by addTarget).
    const xcc = project.pbxXCBuildConfigurationSection()
    for (const key of Object.keys(xcc)) {
      if (key.endsWith("_comment")) continue
      const conf = xcc[key]
      if (
        conf &&
        conf.buildSettings &&
        conf.buildSettings.PRODUCT_NAME &&
        String(conf.buildSettings.PRODUCT_NAME).replace(/"/g, "") === KEYBOARD_TARGET_NAME
      ) {
        const s = conf.buildSettings
        s.PRODUCT_BUNDLE_IDENTIFIER = `"${KEYBOARD_BUNDLE_ID}"`
        s.IPHONEOS_DEPLOYMENT_TARGET = DEPLOYMENT_TARGET
        s.TARGETED_DEVICE_FAMILY = '"1,2"'
        s.SWIFT_VERSION = "5.0"
        s.INFOPLIST_FILE = `${KEYBOARD_TARGET_NAME}/Info.plist`
        s.CODE_SIGN_ENTITLEMENTS = `${KEYBOARD_TARGET_NAME}/${KEYBOARD_TARGET_NAME}.entitlements`
        s.CODE_SIGN_STYLE = "Automatic"
        s.SKIP_INSTALL = "YES"
        s.ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES = "YES"
        s.CLANG_ENABLE_MODULES = "YES"
        s.ENABLE_BITCODE = "NO"
        s.LD_RUNPATH_SEARCH_PATHS =
          '"$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"'
      }
    }

    return cfg
  })

module.exports = (config) => withRegisterKeyboardTarget(withCopyKeyboardSources(config))
