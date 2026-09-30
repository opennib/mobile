/**
 * Release configuration for the Android build:
 *
 *  1. Signing. The generated `android/app/build.gradle` signs release builds
 *     with the debug keystore. This wires the `release` signing config to the
 *     Play upload key, read from Gradle properties (normally
 *     `~/.gradle/gradle.properties`, never the repo):
 *
 *       OPENNIB_UPLOAD_STORE_FILE, OPENNIB_UPLOAD_STORE_PASSWORD,
 *       OPENNIB_UPLOAD_KEY_ALIAS,  OPENNIB_UPLOAD_KEY_PASSWORD
 *
 *     When they are absent (CI, other contributors) release builds fall back
 *     to the debug key, which installs fine for local testing but cannot be
 *     uploaded to Play.
 *
 *  2. ABIs. The Bare native addons (whisper, llama, Hypercore stores) ship
 *     prebuilds for `android-arm64` only, so the app must not be offered to
 *     other ABIs: an armeabi-v7a or x86 install would boot and crash on the
 *     first native import. Restrict `reactNativeArchitectures` to arm64-v8a.
 */
const { withAppBuildGradle, withGradleProperties } = require("@expo/config-plugins")

const SIGNING_MARKER = "// opennib: release signing from Gradle properties"

const RELEASE_SIGNING = `
        ${SIGNING_MARKER}
        release {
            if (project.hasProperty('OPENNIB_UPLOAD_STORE_FILE')) {
                storeFile file(OPENNIB_UPLOAD_STORE_FILE)
                storePassword OPENNIB_UPLOAD_STORE_PASSWORD
                keyAlias OPENNIB_UPLOAD_KEY_ALIAS
                keyPassword OPENNIB_UPLOAD_KEY_PASSWORD
            }
        }`

function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let s = cfg.modResults.contents
    if (s.includes(SIGNING_MARKER)) return cfg

    // Add a `release` entry to signingConfigs, right after the debug one.
    const debugEnd = s.indexOf("keyPassword 'android'\n        }")
    if (debugEnd < 0) throw new Error("with-release-config: debug signingConfig not found")
    const insertAt = s.indexOf("}", debugEnd + "keyPassword 'android'\n".length) + 1
    s = s.slice(0, insertAt) + RELEASE_SIGNING + s.slice(insertAt)

    // Point the release build type at it (only when the upload key is configured).
    const releaseUsesDebug =
      "signingConfig signingConfigs.debug\n            def enableShrinkResources"
    if (!s.includes(releaseUsesDebug)) {
      throw new Error("with-release-config: release buildType signingConfig line not found")
    }
    s = s.replace(
      releaseUsesDebug,
      "signingConfig project.hasProperty('OPENNIB_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug\n            def enableShrinkResources",
    )
    cfg.modResults.contents = s
    return cfg
  })
}

function withArm64Only(config) {
  return withGradleProperties(config, (cfg) => {
    const props = cfg.modResults.filter(
      (p) => !(p.type === "property" && p.key === "reactNativeArchitectures"),
    )
    props.push({ type: "property", key: "reactNativeArchitectures", value: "arm64-v8a" })
    cfg.modResults = props
    return cfg
  })
}

module.exports = function withReleaseConfig(config) {
  return withArm64Only(withReleaseSigning(config))
}
