import path from "node:path"

import { Effect, Option, Schema } from "effect"
import * as JsonStore from "effect-lib/json-store"

const configHome =
  process.env.XDG_CONFIG_HOME ?? path.join(process.env.HOME ?? "", ".config")

/** Path to humi's config file. */
export const configPath = path.join(configHome, "humi", "config.json")

const minutes = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1, { expected: "a whole number of minutes" })
)

/** How long each active scan lasts when the config does not say. */
export const defaultActiveScanSeconds = 30

/** Which meter to read and how often, set with `humi config set`. */
export class HumiConfig extends Schema.Class<HumiConfig>("HumiConfig")({
  /** Bluetooth address of the meter. */
  mac: Schema.String.check(
    Schema.isPattern(/^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$/u, {
      expected: "a Bluetooth address like EC:0F:01:46:10:4A",
    })
  ),
  /** Minutes between passive scans, which read temperature and humidity. */
  passiveScanMinutes: minutes,
  /** Minutes between active scans, which read the battery. */
  activeScanMinutes: minutes,
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
}) {}

/** The active scan duration, falling back to the default. */
export const activeScanSeconds = (config: HumiConfig): number =>
  config.activeScanSeconds ?? defaultActiveScanSeconds

/** Every flag of the `humi config set` that creates the config. */
export const configSetUsage =
  "--mac <address> --passive-scan-minutes <minutes> --active-scan-minutes <minutes>"

/** Raised when humi runs before `humi config set` created the config. */
export class ConfigMissingError extends Schema.TaggedError<ConfigMissingError>()(
  "ConfigMissingError",
  { message: Schema.String }
) {}

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
