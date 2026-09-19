<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/tetherto/qvac/main/assets/badge-dark.svg">
    <img alt="Built with QVAC" src="https://raw.githubusercontent.com/tetherto/qvac/main/assets/badge-light.svg" height="28">
  </picture>
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-black" height="28"></a>
</p>

# opennib mobile

Free, open-source, fully on-device dictation for iPhone and Android. Hold a
button, speak, release: Whisper transcribes on the device and the text lands
in your app. No account, no cloud, no telemetry.

- **iOS:** the app plus a custom keyboard extension, so dictation works
  system-wide in any text field.
- **Android:** the app plus an input method (IME) with a mic key.
- **Shared with the desktop app:** the business logic, storage and AI
  orchestration come from [`@opennib/core`](https://github.com/opennib/core);
  this repository is the mobile shell around it.

## Architecture

Two runtimes live inside the app. React Native (Hermes) draws the UI and
captures audio; a [Bare](https://github.com/holepunchto/bare) worker, hosted
through `react-native-bare-kit`, runs everything heavy:

```
┌──────────────────────────────────────────────┐
│ React Native (Hermes)                        │
│  App.tsx · screens · hooks · native modules  │
│  records 16 kHz mono WAV with expo-av        │
└───────────────┬──────────────────────────────┘
                │ HRPC over the worklet IPC stream
                │ (typed contract from @opennib/core/hrpc)
┌───────────────▼──────────────────────────────┐
│ opennib Bare worker  (bare/index.mjs)        │
│  core DictationPipeline:                     │
│    speech gate → whisper → cleanup → history │
│  @qvac/sdk whisper (Bare-direct, in-process) │
│  Hypercore history + dictionary stores       │
└──────────────────────────────────────────────┘
```

One dictation is one `dictate` call: the app records a WAV and the worker
runs core's `DictationPipeline` on it, the same orchestrator the desktop app
uses, so the speech gate, cleanup, dictionary and history behave identically
on both platforms. Hermes never imports `@qvac/sdk` or Hypercore. Whisper
runs inside the worker through the QVAC SDK's Bare-direct mode; the worker
bundle is built by `bare-pack` for `ios-arm64`, `ios-arm64-simulator` and
`android-arm64` and shipped as a base64 string Metro can `require()`.

Text insertion into other apps is platform native:

- **iOS keyboard extension** (`ios-keyboard/`, `ios-shared/`): the extension
  is sandboxed and cannot record or run Whisper, so it only signals record
  intent over Darwin notifications; the host app records, transcribes, and
  writes the transcript to the shared App Group, from which the keyboard
  inserts it. The host stays alive in the background with an active audio
  session. Full details in the header of `ios-keyboard/KeyboardViewController.swift`.
- **Android IME** (`android-ime/`): `OpennibInputMethodService` captures audio
  itself and hands it to the React Native process over a local bridge, with
  a keepalive service so the JS side is reachable while the keyboard is up.

## Getting started

Requirements: Node.js ≥ 22.17, npm. iOS: Xcode 15+, CocoaPods. Android:
Android Studio, a device or emulator on API 29+.

```sh
npm install
npm run prebuild      # bundles the Bare worker, then `expo prebuild`
npm run ios           # or: npm run android
```

`expo prebuild` generates `ios/` and `android/` from `app.json` and the
config plugins in `plugins/`; both folders are git-ignored and never edited
by hand. The first iOS run also runs `pod install`, which takes a while.
**Every fresh clone or `node_modules` wipe needs `npm run prebuild` again**;
the reasons and the error messages you'll see otherwise are in
[`docs/setup.md`](docs/setup.md).

Android over USB needs Metro reachable from the device:

```sh
adb reverse tcp:8081 tcp:8081
```

### Using the iOS keyboard

Settings → General → Keyboard → Keyboards → Add New Keyboard → opennib, then
open it and turn on **Allow Full Access**. Without Full Access the keyboard
cannot read the shared transcript or signal the host app.

## Scripts

| Script                | What it does                                           |
| --------------------- | ------------------------------------------------------ |
| `npm start`           | Metro dev server                                       |
| `npm run ios`         | `expo run:ios`                                         |
| `npm run android`     | `expo run:android`                                     |
| `npm run bundle:bare` | rebuild `bare/worker.bundle.cjs` from `bare/index.mjs` |
| `npm run prebuild`    | `bundle:bare` + `expo prebuild`                        |
| `npm run typecheck`   | `tsc --noEmit`                                         |
| `npm run format`      | Prettier                                               |

## Repository layout

```
App.tsx, index.ts        app entry
src/                     screens, hooks, platform adapters, native module wrappers
bare/index.mjs           the Bare worker (whisper + cleanup + Hypercore stores)
scripts/bundle-bare.mjs  bare-pack driver for the worker bundle
plugins/                 Expo config plugins (QVAC SDK bundle, App Group,
                         keyboard extension, shared module, Android IME,
                         addon manifest)
ios-keyboard/            Swift keyboard extension
ios-shared/              ObjC bridge shared by host app and keyboard
android-ime/             Kotlin input method service
qvac.config.json         QVAC plugins the worker registers (whisper only)
docs/setup.md            first-run requirements and troubleshooting
```

## Status and known limitations

- **iOS is the validated platform.** App, keyboard extension, and Hypercore
  history and dictionary run end-to-end on device.
- **Android is not stable.** The IME and app are complete, but a clean
  install can crash-loop inside the Bare runtime during the first model
  download on some devices. Treat Android as a preview.
- **No LLM cleanup on mobile.** The QVAC SDK registry has no Qwen2.5-Instruct
  weights for on-device download, so the transcript cleanup that desktop
  offers is disabled here; the plumbing is in place for when a model lands.
- **Models download on first use**, not bundled. The first dictation after
  install needs a network connection and some patience. Nothing else does.
- **Builds are unsigned for distribution.** Development provisioning only;
  App Store and Play Store distribution come with v1.0.

## Related

- [`@opennib/core`](https://github.com/opennib/core) — the shared engine
- [opennib desktop](https://github.com/opennib/desktop) — macOS, Windows, Linux

## License

MIT — see [LICENSE](LICENSE).
