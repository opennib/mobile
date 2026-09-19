"use strict"

const { withDangerousMod } = require("@expo/config-plugins")
const fs = require("fs")
const path = require("path")

/**
 * Shim for `@qvac/sdk/dist/expo/plugins/withQvacSDK` — that file is ESM and
 * Expo's CJS plugin resolver can't `require()` it (ERR_REQUIRE_ESM). So we
 * reimplement the parts opennib needs:
 *
 *   1. Patch react-native-bare-kit's link.mjs files so bare-link uses the
 *      addons manifest (drops unused native addons → smaller binary).
 *   2. Call `bundleSdk` + `verifyBundle` from `@qvac/sdk/commands` to produce
 *      the SDK's mobile worker bundle. SDK runtime imports it as
 *      `@qvac/sdk/worker.mobile.bundle` — without this file the dictation
 *      pipeline fails at boot with RPC_CONNECTION_FAILED.
 *   3. Copy the generated bundle to `node_modules/@qvac/sdk/dist/worker.mobile.bundle.js`
 *      where the SDK runtime expects to find it.
 *
 * Mirrors the upstream withMobileBundle.js (SDK 0.16.0) verbatim other than
 * being CJS instead of ESM. 0.16.0 dropped the `@qvac/cli` shell-out the
 * 0.9.1 recipe used; the bundler now runs in-process. `@qvac/sdk/commands`
 * is ESM, so the async mod reaches it with a dynamic `import()` — that works
 * from CJS even though a top-level `require()` of the SDK would not.
 */

const CONFIG_CANDIDATES = ["qvac.config.json", "qvac.config.js", "qvac.config.mjs"]
const DEFERRED_MODULES = ["expo-file-system", "react-native-bare-kit"]
const MOBILE_HOSTS = ["android-arm64", "ios-arm64", "ios-arm64-simulator", "ios-x64-simulator"]

function resolveSDKPackageDir(projectRoot) {
  // @qvac/sdk's `exports` field blocks `./package.json`, so we can't go
  // through `require.resolve("@qvac/sdk/package.json")`. Resolve the main
  // entry instead and walk up to the package root.
  let cursor = require.resolve("@qvac/sdk", { paths: [projectRoot] })
  for (let i = 0; i < 12; i++) {
    const candidate = path.join(cursor, "package.json")
    if (fs.existsSync(candidate)) {
      const pkg = JSON.parse(fs.readFileSync(candidate, "utf8"))
      if (pkg.name === "@qvac/sdk") return { name: "@qvac/sdk", dir: cursor }
    }
    const parent = path.dirname(cursor)
    if (parent === cursor) break
    cursor = parent
  }
  throw new Error(`QVAC: could not locate @qvac/sdk package root from ${projectRoot}`)
}

function findConfigFile(projectRoot) {
  for (const candidate of CONFIG_CANDIDATES) {
    const p = path.join(projectRoot, candidate)
    if (fs.existsSync(p)) return p
  }
  return null
}

function resolveBareKitDir(projectRoot) {
  // In a workspace, react-native-bare-kit may be hoisted to the workspace root
  // rather than living under this app's node_modules. Resolve via Node's
  // package resolution so we find whichever copy is actually wired up.
  try {
    const entry = require.resolve("react-native-bare-kit", { paths: [projectRoot] })
    let cursor = entry
    for (let i = 0; i < 12; i++) {
      const pkg = path.join(cursor, "package.json")
      if (fs.existsSync(pkg)) {
        const meta = JSON.parse(fs.readFileSync(pkg, "utf8"))
        if (meta.name === "react-native-bare-kit") return cursor
      }
      const parent = path.dirname(cursor)
      if (parent === cursor) break
      cursor = parent
    }
  } catch {
    // fall through to the legacy nested path below
  }
  const legacy = path.join(projectRoot, "node_modules", "react-native-bare-kit")
  return fs.existsSync(legacy) ? legacy : null
}

function patchBareKitLinkers(projectRoot, sdkDir) {
  const bareKitPath = resolveBareKitDir(projectRoot)
  if (bareKitPath === null) {
    console.log("⚠️  QVAC: react-native-bare-kit not found, skipping linker patch")
    return
  }
  const patchesDir = path.join(sdkDir, "expo", "plugins", "patches")
  if (!fs.existsSync(patchesDir)) {
    console.log(`⚠️  QVAC: patches dir not found at ${patchesDir}`)
    return
  }
  for (const [patch, target] of [
    [path.join(patchesDir, "android-link.mjs"), path.join(bareKitPath, "android", "link.mjs")],
    [path.join(patchesDir, "ios-link.mjs"), path.join(bareKitPath, "ios", "link.mjs")],
  ]) {
    if (fs.existsSync(patch)) {
      fs.copyFileSync(patch, target)
      console.log(`✅ QVAC: patched ${path.relative(projectRoot, target)}`)
    }
  }
}

function patchBareImportsMap(sdkDir) {
  // SDK 0.16.0 packaging bug: its own @qvac/logging dependency does
  // `require('process')`, but the SDK's bare-imports.json (the builtin→bare
  // mapping handed to bare-pack) has no `process` entry, so bundling dies
  // with MODULE_NOT_FOUND. Add the mapping the same way the map handles fs,
  // os, path, etc. Drop this once upstream ships a fixed bare-imports.json.
  const mapPath = path.join(sdkDir, "bare-imports.json")
  if (!fs.existsSync(mapPath)) return
  const map = JSON.parse(fs.readFileSync(mapPath, "utf8"))
  if (map["process"] === undefined) {
    map["process"] = { bare: "bare-process", default: "process" }
    fs.writeFileSync(mapPath, JSON.stringify(map, null, 2) + "\n")
    console.log("✅ QVAC: added missing 'process' entry to bare-imports.json")
  }
}

async function runBundler(commands, projectRoot, sdkDir, configPath, deferredModules) {
  patchBareKitLinkers(projectRoot, sdkDir)
  patchBareImportsMap(sdkDir)
  await commands.bundleSdk({
    projectRoot,
    sdkPath: sdkDir,
    ...(configPath !== null ? { configPath } : {}),
    hosts: MOBILE_HOSTS,
    defer: deferredModules,
    quiet: true,
  })
}

async function runVerifier(commands, projectRoot, generatedBundle, configPath) {
  if (configPath === null) {
    console.log(
      "⚠️  QVAC: no qvac.config.* found — Bare runtime will be auto-detected from node_modules.",
    )
  }
  const result = await commands.verifyBundle({
    projectRoot,
    addonsSource: generatedBundle,
    hosts: MOBILE_HOSTS,
    ...(configPath !== null ? { configPath } : {}),
  })
  if (commands.hasErrors(result)) {
    throw new Error(
      `QVAC: bundle verification failed for ${generatedBundle}:\n` +
        commands.formatVerifyBundleResult(result),
    )
  }
}

async function buildMobileBundle(config) {
  const projectRoot = config.modRequest.projectRoot
  const sdkPackage = resolveSDKPackageDir(projectRoot)
  const outputPath = path.join(sdkPackage.dir, "dist", "worker.mobile.bundle.js")
  const configPath = findConfigFile(projectRoot)
  if (configPath !== null) {
    console.log(`🕚 QVAC: Found ${path.basename(configPath)}, generating tree-shaken bundle...`)
  } else {
    console.log("🕚 QVAC: No config found, generating default bundle (all plugins)...")
  }
  // ESM-only module — dynamic import() is the one loader CJS shares with it.
  const commands = await import("@qvac/sdk/commands")
  const deferredModules = [...DEFERRED_MODULES, `${sdkPackage.name}/worker.mobile.bundle`]
  await runBundler(commands, projectRoot, sdkPackage.dir, configPath, deferredModules)

  const generated = path.join(projectRoot, "qvac", "worker.bundle.js")
  if (!fs.existsSync(generated)) {
    throw new Error(
      `QVAC: Bundle generation failed — ${generated} not found. ` +
        "Check bundler output above for errors.",
    )
  }
  await runVerifier(commands, projectRoot, generated, configPath)
  fs.copyFileSync(generated, outputPath)
  console.log("🫡 QVAC: Mobile bundle generated and verified")
  return config
}

function withQvacSDK(config) {
  config = withDangerousMod(config, ["android", buildMobileBundle])
  config = withDangerousMod(config, ["ios", buildMobileBundle])
  return config
}

module.exports = withQvacSDK
