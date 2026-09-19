/**
 * Copies the SharedGroup native module source from <project>/ios-shared/ into
 * the host app's Xcode group during prebuild and registers it in the main
 * target's PBXSourcesBuildPhase.
 *
 * Bridges App Group writes + Darwin notifications between the keyboard
 * extension and the React Native runtime. Pure Objective-C — subclassing
 * RCTEventEmitter from Swift via the bridging header proved unreliable on
 * RN 0.81's prebuilt React-Core framework.
 *
 * The host target name is derived from the Expo `name` slug, sanitized by
 * `expo prebuild` to "opennib" for this project.
 */
const { withXcodeProject, withDangerousMod } = require("@expo/config-plugins")
const fs = require("fs")
const path = require("path")

const HOST_TARGET_NAME = "opennib"
const FILES = ["SharedGroup.m"]
const STALE = ["SharedGroup.swift"]

const withCopySharedGroup = (config) =>
  withDangerousMod(config, [
    "ios",
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot
      const platformRoot = cfg.modRequest.platformProjectRoot
      const src = path.join(projectRoot, "ios-shared")
      const dst = path.join(platformRoot, HOST_TARGET_NAME)
      if (!fs.existsSync(src)) {
        throw new Error(`with-shared-group-module: ${src} not found`)
      }
      for (const file of FILES) {
        const from = path.join(src, file)
        const to = path.join(dst, file)
        if (!fs.existsSync(from)) {
          throw new Error(`with-shared-group-module: missing ${from}`)
        }
        fs.copyFileSync(from, to)
      }
      // Clean up files from prior iterations that are no longer used.
      for (const file of STALE) {
        const stalePath = path.join(dst, file)
        if (fs.existsSync(stalePath)) fs.unlinkSync(stalePath)
      }
      return cfg
    },
  ])

const withRegisterSharedGroup = (config) =>
  withXcodeProject(config, async (cfg) => {
    const project = cfg.modResults

    // Find the main app target's PBXGroup.
    const groups = project.hash.project.objects.PBXGroup
    let mainGroupKey = null
    for (const key of Object.keys(groups)) {
      if (key.endsWith("_comment")) continue
      const g = groups[key]
      if (g && (g.name === HOST_TARGET_NAME || g.path === HOST_TARGET_NAME)) {
        mainGroupKey = key
        break
      }
    }
    if (!mainGroupKey) {
      throw new Error(`with-shared-group-module: ${HOST_TARGET_NAME} group not found`)
    }

    const targets = project.pbxNativeTargetSection()
    let mainTargetUuid = null
    for (const key of Object.keys(targets)) {
      if (key.endsWith("_comment")) continue
      const t = targets[key]
      if (t && (t.name === HOST_TARGET_NAME || t.name === `"${HOST_TARGET_NAME}"`)) {
        mainTargetUuid = key
        break
      }
    }
    if (!mainTargetUuid) {
      throw new Error(`with-shared-group-module: ${HOST_TARGET_NAME} target not found`)
    }

    // Strip stale Swift file references and their build-phase entries.
    removeFileEverywhere(project, "SharedGroup.swift")

    // Idempotency: skip if .m already registered.
    const fileRefs = project.pbxFileReferenceSection()
    let alreadyRegistered = false
    for (const key of Object.keys(fileRefs)) {
      if (key.endsWith("_comment")) continue
      const ref = fileRefs[key]
      if (ref && (ref.path === "SharedGroup.m" || ref.path === '"SharedGroup.m"')) {
        alreadyRegistered = true
        break
      }
    }
    if (!alreadyRegistered) {
      project.addSourceFile(
        `${HOST_TARGET_NAME}/SharedGroup.m`,
        { target: mainTargetUuid },
        mainGroupKey,
      )
    }

    return cfg
  })

function removeFileEverywhere(project, filename) {
  const fileRefs = project.pbxFileReferenceSection()
  const buildFiles = project.pbxBuildFileSection()
  const groups = project.hash.project.objects.PBXGroup
  const sources = project.hash.project.objects.PBXSourcesBuildPhase || {}

  const fileRefKeys = []
  for (const key of Object.keys(fileRefs)) {
    if (key.endsWith("_comment")) continue
    const ref = fileRefs[key]
    if (!ref) continue
    const p = String(ref.path || "").replace(/"/g, "")
    if (p === filename || p.endsWith("/" + filename)) {
      fileRefKeys.push(key)
    }
  }

  // Build files: match by fileRef OR by comment ("<filename> in Sources") so that
  // dangling entries left behind by a previous run get swept up too.
  const buildFileKeys = []
  const commentMatch = ` ${filename} in `
  for (const key of Object.keys(buildFiles)) {
    if (key.endsWith("_comment")) continue
    const bf = buildFiles[key]
    if (!bf) continue
    const matchByRef = fileRefKeys.includes(bf.fileRef)
    const commentKey = key + "_comment"
    const matchByComment =
      typeof buildFiles[commentKey] === "string" && buildFiles[commentKey].includes(commentMatch)
    if (matchByRef || matchByComment) buildFileKeys.push(key)
  }

  for (const groupKey of Object.keys(groups)) {
    if (groupKey.endsWith("_comment")) continue
    const g = groups[groupKey]
    if (!g || !Array.isArray(g.children)) continue
    g.children = g.children.filter((c) => !fileRefKeys.includes(c && c.value))
  }

  for (const phaseKey of Object.keys(sources)) {
    if (phaseKey.endsWith("_comment")) continue
    const phase = sources[phaseKey]
    if (!phase || !Array.isArray(phase.files)) continue
    phase.files = phase.files.filter((f) => {
      if (!f) return true
      if (buildFileKeys.includes(f.value)) return false
      if (typeof f.comment === "string" && f.comment.includes(commentMatch)) return false
      return true
    })
  }

  for (const k of fileRefKeys) {
    delete fileRefs[k]
    delete fileRefs[k + "_comment"]
  }
  for (const k of buildFileKeys) {
    delete buildFiles[k]
    delete buildFiles[k + "_comment"]
  }
}

module.exports = (config) => withRegisterSharedGroup(withCopySharedGroup(config))
