#!/usr/bin/env bun
import { BunRuntime, BunServices } from "@effect/platform-bun"
import { Console, DateTime, Effect, Layer, Option, Schema } from "effect"
import { serviceCommand } from "effect-lib/systemd"
import { Command, Flag } from "effect/cli"

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
import { setupBluetooth } from "./setup-bluetooth.ts"

const macFlag = Flag.String("mac").pipe(
  Flag.withDescription("Bluetooth address of the meter"),
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

const collectCommand = Command.make(
  "collect",
  {
    duration: Flag.Int("duration").pipe(
      Flag.withDescription("Stop after this many seconds and print a summary"),
      Flag.optional
    ),
  },
  Effect.fn("collectCommand")(function* collectCommand({ duration }) {
    const readings = yield* Readings
    const config = yield* loadConfig
    const startedAt = DateTime.formatIso(yield* DateTime.now)
    const run = collect(config).pipe(Effect.provide(Bluetooth.layer))

    if (Option.isNone(duration)) {
      return yield* run
    }

    yield* run.pipe(Effect.timeoutOption(`${duration.value} seconds`))
    const { passive, distinct, active } = yield* readings.summary(startedAt)
    return yield* Console.log(
      `In ${duration.value}s: ${passive} passive readings (${distinct} distinct advertisements), ${active} active readings`
    )
  })
).pipe(
  Command.withDescription(
    "Run the passive and active scans on the config's intervals"
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
    yield* Console.log("Active readings")
    for (const reading of yield* readings.latestActive(limit)) {
      yield* Console.log(
        `  ${DateTime.formatIso(reading.recorded_at)}  battery ${reading.battery}%`
      )
    }
  })
).pipe(Command.withDescription("Show the latest passive and active readings"))

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
      `passive scan  every ${config.passiveScanMinutes} min`,
      `active scan   every ${config.activeScanMinutes} min`,
      `              for ${activeScanSeconds(config)}s${config.activeScanSeconds === undefined ? " (default)" : ""}`,
    ].join("\n")
  )

const configSetCommand = Command.make(
  "set",
  {
    mac: macFlag,
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
    const config = yield* Schema.decodeUnknownEffect(HumiConfig)({
      ...values.value,
      mac: values.value.mac.toUpperCase(),
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

const humiService = serviceCommand({
  name: "humi",
  description: "humi humidity and temperature logger",
  command: [process.execPath, import.meta.filename, "collect"],
})

const humi = Command.make("humi").pipe(
  Command.withDescription("Humidity and temperature logger"),
  Command.withSubcommands([
    collectCommand,
    lsCommand,
    configCommand,
    bluetoothCommand,
    setupBluetoothCommand,
    humiService,
  ])
)

const MainLive = Layer.mergeAll(
  BunServices.layer,
  Readings.layer.pipe(Layer.provide(databaseLayer))
).pipe(Layer.provide(BunServices.layer))

BunRuntime.runMain(
  Command.run(humi, { version: "0.1.0" }).pipe(Effect.provide(MainLive))
)
