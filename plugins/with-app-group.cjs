/**
 * Adds the App Group entitlement to the iOS host target so the main app and the
 * keyboard extension can share UserDefaults + a container directory.
 */
const { withEntitlementsPlist } = require("@expo/config-plugins")

const APP_GROUP = "group.com.opennib.mobile"

function withAppGroup(config) {
  return withEntitlementsPlist(config, (cfg) => {
    const existing = cfg.modResults["com.apple.security.application-groups"] || []
    if (!existing.includes(APP_GROUP)) {
      cfg.modResults["com.apple.security.application-groups"] = [...existing, APP_GROUP]
    }
    return cfg
  })
}

module.exports = withAppGroup
