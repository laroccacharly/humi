#!/usr/bin/env bun
import { BunRuntime, BunServices } from "@effect/platform-bun"
import { Console, DateTime, Effect, Layer, Option, Schema } from "effect"
import { Command, Flag } from "effect/cli"

import { Bluetooth } from "./bluetooth.ts"
import { collect } from "./collector.ts"
import {
  ConfigMissingError,
  configPath,
  configStore,
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

const everyFlag = Flag.Int("every").pipe(
  Flag.withDescription("Poll every N minutes, on the minute"),
  Flag.optional
)

const collectCommand = Command.make(
  "collect",
  {
    mac: macFlag.pipe(Flag.withDescription("Overrides the config's mac")),
    every: everyFlag.pipe(Flag.withDescription("Overrides the config's every")),
    cron: Flag.String("cron").pipe(
      Flag.withDescription(
        "Custom poll schedule, overriding --every; six fields include seconds"
      ),
      Flag.optional
    ),
    batteryCron: Flag.String("battery-cron").pipe(
      Flag.withDescription(
        "When to scan actively for the battery level (also checked at start)"
      ),
      Flag.withDefault("0 0 12 * * *")
    ),
    duration: Flag.Int("duration").pipe(
      Flag.withDescription("Stop after this many seconds and print a summary"),
      Flag.optional
    ),
  },
  Effect.fn("collectCommand")(function* collectCommand({
    mac,
    every,
    cron,
    batteryCron,
    duration,
  }) {
    const readings = yield* Readings
    const config = yield* loadConfig
    const startedAt = DateTime.formatIso(yield* DateTime.now)
    const minutes = Option.getOrElse(every, () => config.every)
    const expression = Option.getOrElse(cron, () => `0 */${minutes} * * * *`)
    const run = collect(
      Option.getOrElse(mac, () => config.mac),
      expression,
      batteryCron
    ).pipe(Effect.provide(Bluetooth.layer))

    if (Option.isNone(duration)) {
      yield* run
      return
    }

    yield* run.pipe(Effect.timeoutOption(`${duration.value} seconds`))
    const { total, distinct } = yield* readings.summary(startedAt)
    yield* Console.log(
      `Captured ${total} readings in ${duration.value}s (${distinct} distinct advertisements)`
    )
  })
).pipe(Command.withDescription("Poll the meter on a cron schedule"))

const lsCommand = Command.make(
  "ls",
  {
    limit: Flag.Int("limit").pipe(Flag.withDefault(20)),
  },
  Effect.fn("lsCommand")(function* lsCommand({ limit }) {
    const readings = yield* Readings
    for (const reading of yield* readings.latest(limit)) {
      yield* Console.log(
        `${DateTime.formatIso(reading.recorded_at)}  ${reading.temperature.toFixed(1)}°C  ${reading.humidity}%  battery ${reading.battery ?? "?"}%  rssi ${reading.rssi ?? "?"}`
      )
    }
  })
).pipe(Command.withDescription("Show the latest readings"))

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
      "\nUse one with: humi config set --mac <address> --every <minutes>"
    )
  })
).pipe(Command.withDescription("Scan for nearby SwitchBot devices"))

const bluetoothCommand = Command.make("bluetooth").pipe(
  Command.withDescription("Find Bluetooth devices"),
  Command.withSubcommands([bluetoothLsCommand])
)

const showConfig = (config: HumiConfig) =>
  Console.log(`${configPath}\nmac    ${config.mac}\nevery  ${config.every} min`)

const configSetCommand = Command.make(
  "set",
  { mac: macFlag, every: everyFlag },
  Effect.fn("configSetCommand")(function* configSetCommand({ mac, every }) {
    // The first `set` creates the config, so it needs every field.
    const current = yield* configStore.load
    const values = Option.all({
      mac: Option.orElse(mac, () => current.pipe(Option.map((c) => c.mac))),
      every: Option.orElse(every, () =>
        current.pipe(Option.map((c) => c.every))
      ),
    })
    if (Option.isNone(values)) {
      return yield* new ConfigMissingError({
        message: `No config at ${configPath} yet; pass both --mac and --every`,
      })
    }
    const config = yield* Schema.decodeUnknownEffect(HumiConfig)({
      ...values.value,
      mac: values.value.mac.toUpperCase(),
    })
    yield* configStore.save(config)
    return yield* showConfig(config)
  })
).pipe(
  Command.withDescription(
    "Create the config (needs --mac and --every), or change part of it"
  )
)

const configCommand = Command.make("config", {}, () =>
  loadConfig.pipe(Effect.flatMap(showConfig))
).pipe(
  Command.withDescription("Show the config"),
  Command.withSubcommands([configSetCommand])
)

const humi = Command.make("humi").pipe(
  Command.withDescription("Humidity and temperature logger"),
  Command.withSubcommands([
    collectCommand,
    lsCommand,
    configCommand,
    bluetoothCommand,
    setupBluetoothCommand,
  ])
)

const MainLive = Layer.mergeAll(
  BunServices.layer,
  Readings.layer.pipe(Layer.provide(databaseLayer))
).pipe(Layer.provide(BunServices.layer))

BunRuntime.runMain(
  Command.run(humi, { version: "0.1.0" }).pipe(Effect.provide(MainLive))
)
