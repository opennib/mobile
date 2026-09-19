/**
 * Mirrors qvac/addons.manifest.json into the location bare-link reads from.
 *
 * The QVAC SDK patches react-native-bare-kit's android/link.mjs to be
 * manifest-aware. The patched linker reads
 * `<rnbk-grandparent>/qvac/addons.manifest.json` — i.e. the directory that
 * contains node_modules/. In a single-package project that equals the Expo
 * project root and the SDK's own manifest landing spot. In a workspace with
 * hoisted deps, node_modules lives at the workspace root, but the SDK
 * generates `<app>/qvac/addons.manifest.json` — so the linker
 * never finds it, falls back to scanning the workspace root's package.json,
 * and only links the bare-* deps that happen to be hoisted there.
 *
 * Our opennib Bare worker needs sodium-native, rocksdb-native, quickbit-
 * native, simdle-native, fs-native-extensions, bare-fs, bare-url — all of
 * which are listed in the SDK's manifest already. So copying the manifest
 * to where the linker expects it gives us the right addon set without us
 * having to author our own manifest.
 */
const { withDangerousMod } = require("@expo/config-plugins")
const fs = require("fs")
const path = require("path")

function resolveBareLinkProjectRoot(projectRoot) {
  // bare-link computes its projectRoot as
  // `node_modules/react-native-bare-kit/android/../../..`
  // = the directory that contains node_modules.
  const rnbk = require.resolve("react-native-bare-kit/package.json", {
    paths: [projectRoot],
  })
  // rnbk = .../node_modules/react-native-bare-kit/package.json
  // dirname x3 = parent of node_modules.
  return path.resolve(path.dirname(rnbk), "..", "..")
}

const withBareAddonManifest = (config) =>
  withDangerousMod(config, [
    "android",
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot
      const src = path.join(projectRoot, "qvac", "addons.manifest.json")
      if (!fs.existsSync(src)) {
        console.warn(`[with-bare-addon-manifest] ${src} not found — SDK plugin must run first.`)
        return cfg
      }
      const linkRoot = resolveBareLinkProjectRoot(projectRoot)
      if (path.resolve(linkRoot) === path.resolve(projectRoot)) {
        return cfg // flat install: SDK already wrote it where bare-link reads.
      }
      const dst = path.join(linkRoot, "qvac", "addons.manifest.json")
      fs.mkdirSync(path.dirname(dst), { recursive: true })
      fs.copyFileSync(src, dst)
      console.log(`[with-bare-addon-manifest] mirrored ${src} -> ${dst}`)
      return cfg
    },
  ])

module.exports = withBareAddonManifest
