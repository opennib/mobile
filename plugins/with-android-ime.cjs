/**
 * Adds the opennib Android IME (InputMethodService) + RN bridge module to the
 * generated app/.
 *
 * Source files live at <project>/android-ime/ and get copied into
 * android/app/src/main/{java,res} during prebuild. The manifest is mutated
 * to declare the IME service, and MainApplication.kt is mutated to register
 * OpennibKeyboardPackage so the JS side can subscribe to recordStart /
 * recordStop device events emitted from the IME.
 */
const {
  withAndroidManifest,
  withDangerousMod,
  withMainApplication,
} = require("@expo/config-plugins")
const fs = require("fs")
const path = require("path")

const SERVICE_NAME = "com.opennib.mobile.keyboard.OpennibInputMethodService"
const KEEPALIVE_NAME = "com.opennib.mobile.keyboard.OpennibKeepAliveService"
const SERVICE_PACKAGE_DIR = path.join("com", "opennib", "mobile", "keyboard")
const KOTLIN_FILES = [
  "OpennibAudioCapture.kt",
  "OpennibInputMethodService.kt",
  "OpennibKeepAliveService.kt",
  "OpennibKeyboardBridge.kt",
  "OpennibKeyboardController.kt",
  "OpennibKeyboardPackage.kt",
]

const FOREGROUND_PERMISSIONS = [
  "android.permission.FOREGROUND_SERVICE",
  "android.permission.FOREGROUND_SERVICE_DATA_SYNC",
]

const PACKAGE_IMPORT = "import com.opennib.mobile.keyboard.OpennibKeyboardPackage"
const PACKAGE_REGISTER = "add(OpennibKeyboardPackage())"

const withCopyImeSources = (config) =>
  withDangerousMod(config, [
    "android",
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot
      const platformRoot = cfg.modRequest.platformProjectRoot // android/
      const src = path.join(projectRoot, "android-ime")
      if (!fs.existsSync(src)) {
        throw new Error(`with-android-ime: ${src} not found`)
      }

      const javaDst = path.join(platformRoot, "app", "src", "main", "java", SERVICE_PACKAGE_DIR)
      fs.mkdirSync(javaDst, { recursive: true })
      for (const file of KOTLIN_FILES) {
        const from = path.join(src, file)
        if (!fs.existsSync(from)) {
          throw new Error(`with-android-ime: ${from} missing`)
        }
        fs.copyFileSync(from, path.join(javaDst, file))
      }

      const resDst = path.join(platformRoot, "app", "src", "main", "res")
      for (const sub of ["xml", "layout", "values", "drawable"]) {
        const fromDir = path.join(src, "res", sub)
        if (!fs.existsSync(fromDir)) continue
        const toDir = path.join(resDst, sub)
        fs.mkdirSync(toDir, { recursive: true })
        for (const file of fs.readdirSync(fromDir)) {
          fs.copyFileSync(path.join(fromDir, file), path.join(toDir, file))
        }
      }

      return cfg
    },
  ])

const withImeService = (config) =>
  withAndroidManifest(config, async (cfg) => {
    const manifest = cfg.modResults.manifest
    const application = manifest.application?.[0]
    if (!application) {
      throw new Error("with-android-ime: <application> not found in manifest")
    }

    manifest["uses-permission"] = manifest["uses-permission"] || []
    for (const perm of FOREGROUND_PERMISSIONS) {
      const has = manifest["uses-permission"].some((p) => p.$?.["android:name"] === perm)
      if (!has) {
        manifest["uses-permission"].push({ $: { "android:name": perm } })
      }
    }

    application.service = application.service || []

    const imeExists = application.service.some((s) => s.$?.["android:name"] === SERVICE_NAME)
    if (!imeExists) {
      application.service.push({
        $: {
          "android:name": SERVICE_NAME,
          "android:label": "opennib",
          "android:permission": "android.permission.BIND_INPUT_METHOD",
          "android:exported": "true",
        },
        "intent-filter": [
          {
            action: [{ $: { "android:name": "android.view.InputMethod" } }],
          },
        ],
        "meta-data": [
          {
            $: {
              "android:name": "android.view.im",
              "android:resource": "@xml/method",
            },
          },
        ],
      })
    }

    const keepAliveExists = application.service.some(
      (s) => s.$?.["android:name"] === KEEPALIVE_NAME,
    )
    if (!keepAliveExists) {
      application.service.push({
        $: {
          "android:name": KEEPALIVE_NAME,
          "android:exported": "false",
          "android:foregroundServiceType": "dataSync",
        },
      })
    }

    return cfg
  })

const withRegisterImePackage = (config) =>
  withMainApplication(config, (cfg) => {
    let contents = cfg.modResults.contents

    if (!contents.includes(PACKAGE_IMPORT)) {
      // Insert the import alongside the other com.opennib imports / right
      // after the package declaration. We avoid re-anchoring on a specific
      // existing import so the patch is resilient to RN/Expo template churn.
      contents = contents.replace(/^(package [^\n]+\n)/m, `$1\n${PACKAGE_IMPORT}\n`)
    }

    if (!contents.includes(PACKAGE_REGISTER)) {
      // Modern Expo template uses an apply-block:
      //
      //   override fun getPackages(): List<ReactPackage> =
      //     PackageList(this).packages.apply {
      //       // Packages that cannot be autolinked yet can be added manually
      //       // here, for example:
      //       // add(MyReactNativePackage())
      //     }
      //
      // Anchor on the placeholder comment so we drop our `add(...)` inside
      // the apply block at the same indentation level.
      const next = contents.replace(
        /(\n([ \t]+)\/\/ add\(MyReactNativePackage\(\)\))\n/,
        `$1\n$2${PACKAGE_REGISTER}\n`,
      )
      if (next === contents) {
        throw new Error(
          "with-android-ime: could not locate getPackages() apply-block in MainApplication",
        )
      }
      contents = next
    }

    cfg.modResults.contents = contents
    return cfg
  })

module.exports = (config) => withRegisterImePackage(withImeService(withCopyImeSources(config)))
