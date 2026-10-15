#!/usr/bin/env bun
import { BunRuntime, BunServices } from "@effect/platform-bun"
import { Console, DateTime, Effect, Layer, Option, Schema } from "effect"
import * as Credentials from "effect-lib/credentials"
import * as Push from "effect-lib/push"
import { serviceCommand } from "effect-lib/systemd"
import { Command, Flag } from "effect/cli"
import { FetchHttpClient } from "effect/http"

import { Bluetooth } from "./bluetooth.ts"
import { collect } from "./collector.ts"
import {
  ConfigMissingError,
  configPath,
  configSetUsage,
  configStore,
  activeScanSeconds,
  defaultActiveScanSeconds,
  HumiConfig,
  loadConfig,
} from "./config.ts"
import { layer as databaseLayer } from "./db/database.ts"
import { Readings } from "./db/readings.ts"
import { findSwitchbots } from "./discover.ts"
import type { PlugState } from "./plug.ts"
import { plugStatus, switchPlug } from "./plug.ts"
import { serve } from "./server.ts"
import { setupBluetooth } from "./setup-bluetooth.ts"

const macFlag = Flag.String("mac").pipe(
  Flag.withDescription("Bluetooth address of the meter"),
  Flag.optional
)

const plugMacFlag = Flag.String("plug-mac").pipe(
  Flag.withDescription("Bluetooth address of the SwitchBot Plug Mini"),
  Flag.optional
)

const plugOnHumidityFlag = Flag.Int("plug-on-humidity").pipe(
  Flag.withDescription("Humidity (%) at or above which the plug turns on"),
  Flag.optional
)

const plugOffHumidityFlag = Flag.Int("plug-off-humidity").pipe(
  Flag.withDescription("Humidity (%) at or below which the plug turns off"),
  Flag.optional
)

const passiveScanMinutesFlag = Flag.Int("passive-scan-minutes").pipe(
  Flag.withDescription("Minutes between passive scans (temperature, humidity)"),
  Flag.optional
)

const activeScanMinutesFlag = Flag.Int("active-scan-minutes").pipe(
  Flag.withDescription("Minutes between active scans (battery)"),
  Flag.optional
)

const activeScanSecondsFlag = Flag.Int("active-scan-seconds").pipe(
  Flag.withDescription(
    `How long each active scan lasts (default ${defaultActiveScanSeconds}s)`
  ),
  Flag.optional
)

const runCommand = Command.make(
  "run",
  {
    duration: Flag.Int("duration").pipe(
      Flag.withDescription("Stop after this many seconds and print a summary"),
      Flag.optional
    ),
    port: Flag.Int("port").pipe(
      Flag.withDescription("Port for the UI (default: any free port)"),
      Flag.withDefault(0)
    ),
  },
  Effect.fn("runCommand")(function* runCommand({ duration, port }) {
    const readings = yield* Readings
    const config = yield* loadConfig
    const startedAt = DateTime.formatIso(yield* DateTime.now)
    const run = serve(port).pipe(
      Effect.andThen(collect(config)),
      Effect.provide(Bluetooth.layer),
      Effect.scoped
    )

    if (Option.isNone(duration)) {
      return yield* run
    }

    yield* run.pipe(Effect.timeoutOption(`${duration.value} seconds`))
    const { passive, distinct, plug, active } =
      yield* readings.summary(startedAt)
    return yield* Console.log(
      `In ${duration.value}s: ${passive} passive readings (${distinct} distinct advertisements), ${plug} plug readings, ${active} active readings`
    )
  })
).pipe(
  Command.withDescription(
    "Run the scans on the config's intervals and serve the UI"
  )
)

const lsCommand = Command.make(
  "ls",
  {
    limit: Flag.Int("limit").pipe(Flag.withDefault(20)),
  },
  Effect.fn("lsCommand")(function* lsCommand({ limit }) {
    const readings = yield* Readings
    yield* Console.log("Passive readings")
    for (const reading of yield* readings.latestPassive(limit)) {
      yield* Console.log(
        `  ${DateTime.formatIso(reading.recorded_at)}  ${reading.temperature.toFixed(1)}°C  ${reading.humidity}%  rssi ${reading.rssi ?? "?"}`
      )
    }
    yield* Console.log("Plug readings")
    for (const reading of yield* readings.latestPlug(limit)) {
      yield* Console.log(
        `  ${DateTime.formatIso(reading.recorded_at)}  ${reading.is_on ? "on " : "off"}  ${reading.watts.toFixed(1)} W  rssi ${reading.rssi ?? "?"}`
      )
    }
    yield* Console.log("Active readings")
    for (const reading of yield* readings.latestActive(limit)) {
      yield* Console.log(
        `  ${DateTime.formatIso(reading.recorded_at)}  battery ${reading.battery}%`
      )
    }
  })
).pipe(
  Command.withDescription("Show the latest passive, plug and active readings")
)

const setupBluetoothCommand = Command.make(
  "setup-bluetooth",
  {},
  setupBluetooth
).pipe(
  Command.withDescription(
    "One-time: enable BlueZ passive monitoring (asks for your password)"
  )
)

const bluetoothLsCommand = Command.make(
  "ls",
  {
    seconds: Flag.Int("seconds").pipe(
      Flag.withDescription("How long to scan"),
      Flag.withDefault(10)
    ),
  },
  Effect.fn("bluetoothLsCommand")(function* bluetoothLsCommand({ seconds }) {
    yield* Console.log(`Scanning for SwitchBot devices for ${seconds}s...`)
    const found = yield* findSwitchbots(seconds).pipe(
      Effect.provide(Bluetooth.layer)
    )
    if (found.length === 0) {
      return yield* Console.log("None found. Is the meter in range?")
    }
    for (const device of found) {
      const rssi = Option.match(device.rssi, {
        onNone: () => "rssi ?",
        onSome: (dbm) => `rssi ${dbm}`,
      })
      const reading = Option.match(device.measurement, {
        onNone: () => "not an Indoor/Outdoor meter",
        onSome: (m) => `${m.temperature.toFixed(1)}°C  ${m.humidity}%`,
      })
      yield* Console.log(`${device.mac}  ${rssi}  ${reading}  ${device.name}`)
    }
    return yield* Console.log(
      `\nUse one with: humi config set ${configSetUsage}`
    )
  })
).pipe(Command.withDescription("Scan for nearby SwitchBot devices"))

const bluetoothCommand = Command.make("bluetooth").pipe(
  Command.withDescription("Find Bluetooth devices"),
  Command.withSubcommands([bluetoothLsCommand])
)

const showConfig = (config: HumiConfig) =>
  Console.log(
    [
      configPath,
      `mac           ${config.mac}`,
      `plug mac      ${config.plugMac ?? "(not set)"}`,
      `plug on at    ${config.plugOnHumidity === undefined ? "(not set)" : `${config.plugOnHumidity}%`}`,
      `plug off at   ${config.plugOffHumidity === undefined ? "(not set)" : `${config.plugOffHumidity}%`}`,
      `passive scan  every ${config.passiveScanMinutes} min`,
      `active scan   every ${config.activeScanMinutes} min`,
      `              for ${activeScanSeconds(config)}s${config.activeScanSeconds === undefined ? " (default)" : ""}`,
    ].join("\n")
  )

const configSetCommand = Command.make(
  "set",
  {
    mac: macFlag,
    plugMac: plugMacFlag,
    plugOnHumidity: plugOnHumidityFlag,
    plugOffHumidity: plugOffHumidityFlag,
    passiveScanMinutes: passiveScanMinutesFlag,
    activeScanMinutes: activeScanMinutesFlag,
    activeScanSeconds: activeScanSecondsFlag,
  },
  Effect.fn("configSetCommand")(function* configSetCommand(flags) {
    // The first `set` creates the config, so it needs every required field.
    const current = yield* configStore.load
    const saved = <A>(get: (config: HumiConfig) => A) =>
      current.pipe(Option.map(get))
    const values = Option.all({
      mac: Option.orElse(flags.mac, () => saved((c) => c.mac)),
      passiveScanMinutes: Option.orElse(flags.passiveScanMinutes, () =>
        saved((c) => c.passiveScanMinutes)
      ),
      activeScanMinutes: Option.orElse(flags.activeScanMinutes, () =>
        saved((c) => c.activeScanMinutes)
      ),
    })
    if (Option.isNone(values)) {
      return yield* new ConfigMissingError({
        message: `No config at ${configPath} yet; pass ${configSetUsage}`,
      })
    }
    // Optional, and left out of the file until set, so the default applies.
    const seconds = Option.orElse(flags.activeScanSeconds, () =>
      current.pipe(Option.flatMapNullishOr((c) => c.activeScanSeconds))
    )
    const plugMac = Option.orElse(flags.plugMac, () =>
      current.pipe(Option.flatMapNullishOr((c) => c.plugMac))
    )
    const plugOn = Option.orElse(flags.plugOnHumidity, () =>
      current.pipe(Option.flatMapNullishOr((c) => c.plugOnHumidity))
    )
    const plugOff = Option.orElse(flags.plugOffHumidity, () =>
      current.pipe(Option.flatMapNullishOr((c) => c.plugOffHumidity))
    )
    const config = yield* Schema.decodeUnknownEffect(HumiConfig)({
      ...values.value,
      mac: values.value.mac.toUpperCase(),
      ...Option.match(plugMac, {
        onNone: () => ({}),
        onSome: (value) => ({ plugMac: value.toUpperCase() }),
      }),
      ...Option.match(plugOn, {
        onNone: () => ({}),
        onSome: (value) => ({ plugOnHumidity: value }),
      }),
      ...Option.match(plugOff, {
        onNone: () => ({}),
        onSome: (value) => ({ plugOffHumidity: value }),
      }),
      ...Option.match(seconds, {
        onNone: () => ({}),
        onSome: (value) => ({ activeScanSeconds: value }),
      }),
    })
    yield* configStore.save(config)
    return yield* showConfig(config)
  })
).pipe(
  Command.withDescription(
    "Create the config (needs --mac and both intervals), or change part of it"
  )
)

const configCommand = Command.make("config", {}, () =>
  loadConfig.pipe(Effect.flatMap(showConfig))
).pipe(
  Command.withDescription("Show the config"),
  Command.withSubcommands([configSetCommand])
)

const plugMacOverride = Flag.String("mac").pipe(
  Flag.withDescription("Bluetooth address of the plug (default: config)"),
  Flag.optional
)

/** The plug from `--mac`, or else the config's. */
const plugAddress: (
  mac: Option.Option<string>
) => Effect.Effect<
  string,
  Effect.Error<typeof loadConfig>,
  Effect.Services<typeof loadConfig>
> = Effect.fn("plugAddress")(function* plugAddress(mac: Option.Option<string>) {
  const address = Option.isSome(mac) ? mac.value : (yield* loadConfig).plugMac
  if (address === undefined) {
    return yield* new ConfigMissingError({
      message:
        "No plug configured; pass --mac or run `humi config set --plug-mac <address>`",
    })
  }
  return address.toUpperCase()
})

const plugStateCommand = (state: PlugState) =>
  Command.make(
    state,
    { mac: plugMacOverride },
    Effect.fn("plugCommand")(function* plugCommand({ mac }) {
      const address = yield* plugAddress(mac)
      yield* switchPlug(address, state)
      return yield* Console.log(`Plug ${address} ${state}`)
    })
  ).pipe(Command.withDescription(`Switch the SwitchBot Plug Mini ${state}`))

const plugStatusCommand = Command.make(
  "status",
  { mac: plugMacOverride },
  Effect.fn("plugStatusCommand")(function* plugStatusCommand({ mac }) {
    const address = yield* plugAddress(mac)
    const status = yield* plugStatus(address)
    return yield* Console.log(
      `Plug ${address} ${status.on ? "on" : "off"}  ${status.watts.toFixed(1)} W  rssi ${status.rssi ?? "?"}`
    )
  })
).pipe(Command.withDescription("Show whether the plug is on, and its power"))

const plugCommand = Command.make("plug").pipe(
  Command.withDescription("Switch the SwitchBot Plug Mini"),
  Command.withSubcommands([
    plugStateCommand("on"),
    plugStateCommand("off"),
    plugStatusCommand,
  ])
)

/** The Pushover credentials that alerts are sent with. */
const credentials = Credentials.make([Push.AppToken, Push.UserKey])

const humiService = serviceCommand({
  name: "humi",
  description: "humi humidity and temperature logger",
  // A fixed port so the UI keeps the same URL across restarts.
  script: import.meta.filename,
  args: ["run", "--port", "7878"],
})

const humi = Command.make("humi").pipe(
  Command.withDescription("Humidity and temperature logger"),
  Command.withSubcommands([
    runCommand,
    lsCommand,
    configCommand,
    bluetoothCommand,
    plugCommand,
    setupBluetoothCommand,
    humiService,
    ...credentials.commands,
  ])
)

const MainLive = Layer.mergeAll(
  BunServices.layer,
  Readings.layer.pipe(Layer.provide(databaseLayer)),
  Push.layer().pipe(Layer.provide(FetchHttpClient.layer))
).pipe(
  Layer.provideMerge(credentials.layer(Credentials.bunKeyring())),
  Layer.provide(BunServices.layer)
)

BunRuntime.runMain(
  Command.run(humi, { version: "0.1.0" }).pipe(Effect.provide(MainLive))
)
