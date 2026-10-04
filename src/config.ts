import path from "node:path"

import { Effect, Option, Schema } from "effect"
import * as JsonStore from "effect-lib/json-store"

const configHome =
  process.env.XDG_CONFIG_HOME ?? path.join(process.env.HOME ?? "", ".config")

/** Path to humi's config file. */
export const configPath = path.join(configHome, "humi", "config.json")

/** Which meter to read and how often, set with `humi config set`. */
export class HumiConfig extends Schema.Class<HumiConfig>("HumiConfig")({
  /** Bluetooth address of the meter. */
  mac: Schema.String.check(
    Schema.isPattern(/^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$/u, {
      expected: "a Bluetooth address like EC:0F:01:46:10:4A",
    })
  ),
  /** Poll every N minutes, on the minute (a cron step, hence below 60). */
  every: Schema.Int.check(
    Schema.isBetween(
      { minimum: 1, maximum: 59 },
      { expected: "a number of minutes from 1 to 59" }
    )
  ),
}) {}

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
            message: `No config at ${configPath}; create it with \`humi config set --mac <address> --every <minutes>\``,
          })
        ),
      onSome: Effect.succeed,
    })
  )
)
