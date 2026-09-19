/**
 * CJS shim for @qvac/sdk/expo-plugin (which is ESM-only).
 *
 * Expo's plugin loader uses CommonJS `require()` and cannot load ESM modules
 * synchronously. Returning the wrapped plugin as a Promise lets Expo await it.
 *
 * This file is interop glue — it has no project-specific logic.
 */
let cached = null
let pending = null

function load() {
  if (cached) return Promise.resolve(cached)
  if (!pending) {
    pending = import("@qvac/sdk/expo-plugin").then((m) => {
      cached = m.default ?? m
      return cached
    })
  }
  return pending
}

module.exports = function withQvacSDK(config, props) {
  return load().then((plugin) => plugin(config, props))
}
