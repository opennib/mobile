# Setup

The app depends on two generated artifacts that a plain `npm install` does
not create. Skip them and the dev app boots straight into `Cannot find module`
errors.

| File                                                  | Generator                                        | Purpose                                                                                  |
| ----------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `bare/worker.bundle.cjs`                              | `npm run bundle:bare` (bare-pack)                | opennib's Bare worker: whisper via `@qvac/sdk`, cleanup, Hypercore history + dictionary. |
| `node_modules/@qvac/sdk/dist/worker.mobile.bundle.js` | `expo prebuild`, via `plugins/with-qvac-sdk.cjs` | The QVAC SDK's own mobile bundle; the SDK client refuses to boot without it.             |

`npm run prebuild` produces both and then generates the native projects.

## First run, and after every `node_modules` wipe

```sh
npm install
npm run prebuild        # bundle:bare + expo prebuild (ios/ and android/)
cd ios && pod install && cd ..   # first iOS run only; see below
npm run ios             # or: npm run android
```

`expo prebuild` runs `pod install` the first time it creates `ios/`. On later
runs it reuses the folder and does not, but the Bare-kit **addon linker only
executes during `pod install`**. So after re-running prebuild, or after any
change to the QVAC plugin list, run `pod install` yourself, then rebuild.

## Why `plugins/with-qvac-sdk.cjs` exists

`@qvac/sdk` ships an Expo config plugin, but the plugin entry is ESM and
Expo's plugin loader is CommonJS, so `app.json` cannot reference it
directly. The shim reimplements the SDK's `withMobileBundle` step in CJS:

1. patch `react-native-bare-kit`'s `link.mjs` so bare-link honours the addons
   manifest (unused native addons are left out of the binary);
2. call `bundleSdk` and `verifyBundle` from `@qvac/sdk/commands` to build the
   SDK's mobile worker bundle for the mobile hosts;
3. copy the bundle to where the SDK runtime expects it.

`qvac.config.json` lists the SDK plugins the worker registers. Only whisper
is listed: the llama plugin's native framework is not linked into the app,
and LLM cleanup is unavailable on mobile anyway (no Qwen2.5 weights in the
SDK registry).

When the SDK ships a CJS-loadable `app.plugin.js`, delete the shim and
reference the SDK plugin from `app.json` directly.

## Pinned build tooling

`package.json` pins two packages the bundler needs:

- **`bare-module-lexer` 1.4.7** (`overrides`). The native lexer behind
  bare-pack; 1.6.x segfaults on its first call under Node 22 on Apple
  Silicon, which kills both the opennib worker bundle and the SDK's mobile
  bundle with exit code 139 and no output.
- **`bare-pack` 2.0.1** (direct devDependency + `overrides`). The 2.0 line
  matches that lexer, and a top-level, executable copy is where the SDK's
  bundler and `scripts/bundle-bare.mjs` resolve it.

Re-test and drop both when a fixed lexer ships.

## When to re-run `npm run prebuild`

- after `npm install` regenerated `node_modules/@qvac/sdk/` (the SDK bundle
  lives inside it and is wiped with the package);
- after bumping `@qvac/sdk` or `react-native-bare-kit`;
- after editing anything under `plugins/` or `app.json`;
- after editing `bare/index.mjs` or its dependency graph (`bundle:bare` alone
  is enough for that).

Day-to-day JS edits don't need it; Metro picks them up.

## Troubleshooting

### `Cannot find module '@qvac/sdk/worker.mobile.bundle'` at boot

`expo prebuild` did not run (or ran before `npm install` regenerated the SDK
package). Run `npm run prebuild` and rebuild.

### `AddonError: ADDON_NOT_FOUND: Cannot find addon '.' imported from …/@qvac/transcription-whispercpp/binding.js`

The native addon is not linked into the app binary.

1. `pod install` did not run after prebuild. Run it in `ios/`, confirm
   `node_modules/react-native-bare-kit/ios/addons/` now contains
   `qvac__transcription-whispercpp.<version>.xcframework`, rebuild.
2. Xcode is serving a stale framework from DerivedData. Incremental builds
   don't re-copy vendored frameworks:
   ```sh
   rm -rf ~/Library/Developer/Xcode/DerivedData/opennib-*
   npm run ios
   ```
3. The addon version the bundle asks for differs from the one linked. Never
   pin `@qvac/transcription-whispercpp` yourself; the SDK's own dependency
   decides, and three places (bundle, xcframework, addons dir) must agree.

### `pod install` / Gradle fail with blocked hostnames

If your shell wraps `npm` in a package firewall (for example Socket's
`sfw`), the native build inherits its proxy and CocoaPods, Maven Central and
the React Native artifact host get blocked. Run the build past the wrapper
(`\npm run ios` skips a shell alias) or allow those hosts in the firewall.

### Android: white screen on a USB device

Metro is unreachable from the device. Run `adb reverse tcp:8081 tcp:8081`
and reload. This is needed again after every device reboot.

### Simulator: `Prepare encountered an error: recorder not prepared`

The iOS Simulator lost the Mac's microphone. Simulator menu → Device →
Microphone must be checked; quit any Mac app holding the mic exclusively;
retry without restarting the Simulator.

### iOS keyboard inserts nothing, or sits on "Transcribing…"

Almost always **Allow Full Access** is off for the opennib keyboard in
Settings → General → Keyboard → Keyboards. Without it the keyboard cannot
read the shared App Group or signal the host app. If a very old build hangs
on "Transcribing…", force-quit the host app.
