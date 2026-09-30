# Google Play listing — opennib

Everything the Play Console asks for, in the order it asks. Assets in this
folder: `play-icon-512.png` (app icon), `feature-graphic.png` (1024×500).
Screenshots: take at least two phone screenshots on device (Home screen idle,
keyboard recording panel), 16:9 or 9:16, min 320 px.

## App details

- **App name:** opennib
- **Short description (80):** Free, private voice dictation. On-device Whisper, no account, no cloud.
- **Full description:**

  opennib turns your voice into text in any app, using a speech model that
  runs entirely on your phone. Hold the mic key on the opennib keyboard,
  speak, release: the text lands where your cursor is.

  • 100% on-device. Audio is transcribed locally with Whisper and discarded.
  • No account, no cloud, no analytics. There are no opennib servers.
  • System-wide: the opennib keyboard works in every app that takes text.
  • Multilingual: dozens of languages, with automatic detection.
  • Free and open source (MIT). Read the code at github.com/opennib.

  On first launch opennib downloads a speech model (about 75 MB). After that
  it works offline.

  Early access: opennib on Android is new. Model loading takes up to a minute
  on older phones, and some apps don't accept keyboard-inserted text yet.
  Please report issues at github.com/opennib/mobile/issues.

- **Category:** Productivity · **Tags:** dictation, speech to text, keyboard
- **Contact email:** hello@opennib.com · **Website:** https://opennib.com
- **Privacy policy:** https://opennib.com/privacy

## App content declarations

- **Data safety:** "Does your app collect or share any of the required user
  data types?" → **No.** Audio is processed on device and not stored; transcripts
  and settings are stored locally only and never transmitted.
- **Ads:** No. **Target audience:** 18+ (or 13+; the app has no content aimed at
  children). **News app:** No. **COVID:** No. **Government app:** No.
- **Content rating questionnaire:** Utility, no user-generated content, no
  violence etc. → Everyone.
- **Foreground service permission (FOREGROUND_SERVICE_DATA_SYNC):** required
  declaration. Text to use:

  > opennib is a keyboard (input method). When the user holds the mic key in
  > another app, the keyboard records audio and the opennib app process
  > transcribes it on-device with Whisper, then returns the text to the
  > keyboard for insertion. The foreground service keeps the app process alive
  > only while the opennib keyboard is showing, so the transcription engine is
  > reachable from the keyboard; it stops when the keyboard is dismissed. No
  > data leaves the device.

  Play may ask for a short screen recording of the keyboard flow.

- **Sensitive permissions:** RECORD_AUDIO is requested at runtime for dictation.
  No SMS/Call Log/Location.

## Release

- **Track:** start with **Open testing** (public opt-in link), promote to
  Production once a few devices confirm the IME flow. Rationale: model load is
  slow on older devices and text insertion is not accepted by every app yet.
- **Release name:** 0.0.1 (1)
- **Release notes:**

  First public build. On-device dictation in any app via the opennib keyboard.
  Known: first model load can take up to a minute on older phones.

- **App signing:** accept Google Play App Signing (Google holds the app key;
  we upload with the upload key from `~/.opennib/opennib-upload.keystore`).
- **Upload:** `android/app/build/outputs/bundle/release/app-release.aab`
