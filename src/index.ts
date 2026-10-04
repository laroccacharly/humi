#!/usr/bin/env bun
import { BunRuntime, BunServices } from "@effect/platform-bun"
import { Console, DateTime, Effect, Layer, Option } from "effect"
import { Command, Flag } from "effect/unstable/cli"

import { Bluetooth } from "./bluetooth.ts"
import { collect } from "./collector.ts"
import { layer as databaseLayer } from "./db/database.ts"
import { Readings } from "./db/readings.ts"
import { setupBluetooth } from "./setup-bluetooth.ts"

/** The SwitchBot Indoor/Outdoor Thermo-Hygrometer found on 2026-10-03. */
const defaultMac = "EC:0F:01:46:10:4A"

const macFlag = Flag.string("mac").pipe(
  Flag.withDescription("Bluetooth address of the meter"),
  Flag.withDefault(defaultMac)
)

const collectCommand = Command.make(
  "collect",
  {
    mac: macFlag,
    every: Flag.integer("every").pipe(
      Flag.withDescription("Poll every N minutes, on the minute"),
      Flag.withDefault(1)
    ),
    cron: Flag.string("cron").pipe(
      Flag.withDescription(
        "Custom poll schedule, overriding --every; six fields include seconds"
      ),
      Flag.optional
    ),
    batteryCron: Flag.string("battery-cron").pipe(
      Flag.withDescription(
        "When to scan actively for the battery level (also checked at start)"
      ),
      Flag.withDefault("0 0 12 * * *")
    ),
    duration: Flag.integer("duration").pipe(
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
    const startedAt = DateTime.formatIso(yield* DateTime.now)
    const expression = Option.getOrElse(cron, () => `0 */${every} * * * *`)
    const run = collect(mac, expression, batteryCron).pipe(
      Effect.provide(Bluetooth.layer)
    )

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
    limit: Flag.integer("limit").pipe(Flag.withDefault(20)),
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

const humi = Command.make("humi").pipe(
  Command.withDescription("Humidity and temperature logger"),
  Command.withSubcommands([collectCommand, lsCommand, setupBluetoothCommand])
)

const MainLive = Layer.mergeAll(
  BunServices.layer,
  Readings.layer.pipe(Layer.provide(databaseLayer))
).pipe(Layer.provide(BunServices.layer))

BunRuntime.runMain(
  Command.run(humi, { version: "0.1.0" }).pipe(Effect.provide(MainLive))
)
