import path from "node:path"

import { Effect, Option, Schema, SchemaTransformation } from "effect"
import * as JsonStore from "effect-lib/json-store"
import type { Ports } from "effect-lib/tailscale"

const configHome =
  process.env.XDG_CONFIG_HOME ?? path.join(process.env.HOME ?? "", ".config")

/** Path to humi's config file. */
export const configPath = path.join(configHome, "humi", "config.json")

const minutes = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1, { expected: "a whole number of minutes" })
)

/** How long each active scan lasts when the config does not say. */
export const defaultActiveScanSeconds = 30

// Saved in uppercase, the way BlueZ reports addresses, whatever case it was set in.
const address = Schema.String.pipe(
  Schema.decodeTo(
    Schema.String.check(
      Schema.isPattern(/^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$/u, {
        expected: "a Bluetooth address like C0:FF:EE:12:34:56",
      })
    ),
    SchemaTransformation.toUpperCase()
  )
)

const humidity = Schema.Int.check(
  Schema.isBetween(
    { minimum: 0, maximum: 100 },
    { expected: "a whole percentage of humidity" }
  )
)

/**
 * Which meter to read and how often, set with `humi config set`, and when
 * to switch the plug.
 */
export class HumiConfig extends Schema.Class<HumiConfig>("HumiConfig")(
  Schema.Struct({
    /** Bluetooth address of the meter. */
    mac: address,
    /** Bluetooth address of the SwitchBot Plug Mini that `humi plug` switches. */
    plugMac: Schema.optionalKey(address),
    /** Minutes between passive scans, which read temperature and humidity. */
    passiveScanMinutes: minutes.pipe(
      Schema.withDecodingDefaultKey(Effect.succeed(1))
    ),
    /** Minutes between active scans, which read the battery; daily by default. */
    activeScanMinutes: minutes.pipe(
      Schema.withDecodingDefaultKey(Effect.succeed(1440))
    ),
    /**
     * How long each active scan lasts; `defaultActiveScanSeconds` when absent.
     * Longer scans catch the battery more often but cost the meter more.
     */
    activeScanSeconds: Schema.optionalKey(
      Schema.Int.check(
        Schema.isGreaterThanOrEqualTo(1, {
          expected: "a whole number of seconds",
        })
      )
    ),
    /** Humidity at or above which the plug turns on. */
    plugOnHumidity: Schema.optionalKey(humidity),
    /** Humidity at or below which the plug turns off. */
    plugOffHumidity: Schema.optionalKey(humidity),
  }).check(
    Schema.makeFilter(
      ({ plugOnHumidity, plugOffHumidity }) =>
        plugOnHumidity === undefined ||
        plugOffHumidity === undefined ||
        plugOnHumidity > plugOffHumidity ||
        "plugOnHumidity must be above plugOffHumidity"
    )
  )
) {}

/** The active scan duration, falling back to the default. */
export const activeScanSeconds = (config: HumiConfig): number =>
  config.activeScanSeconds ?? defaultActiveScanSeconds

/** The `humi config set` that creates the config. */
export const configSetUsage = "mac <address>"

/** Raised when humi runs before `humi config set` created the config. */
export class ConfigMissingError extends Schema.TaggedError<ConfigMissingError>()(
  "ConfigMissingError",
  { message: Schema.String }
) {}

/** The config file, with `humi config get | set | unset | list`. */
export const configStore = JsonStore.make(configPath, HumiConfig)

/** The saved config; there are no defaults, so a missing file fails. */
export const loadConfig = configStore.load.pipe(
  Effect.flatMap(
    Option.match({
      onNone: () =>
        Effect.fail(
          new ConfigMissingError({
            message: `No config at ${configPath}; create it with \`humi config set ${configSetUsage}\``,
          })
        ),
      onSome: Effect.succeed,
    })
  )
)

/**
 * The service's UI port, fixed so the URL survives restarts, and the HTTPS
 * port Tailscale Serve publishes it on, apart from the other apps' 8443-8447.
 */
export const ports: Ports = { serverPort: 7878, tailscalePort: 8448 }
