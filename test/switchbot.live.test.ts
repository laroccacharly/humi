import { describe, expect, test } from "bun:test"

import { BunServices } from "@effect/platform-bun"
import { Effect, Option, Schedule } from "effect"

import { Bluetooth } from "../src/bluetooth.ts"
import { decodeOutdoorMeter, parseInfo } from "../src/switchbot.ts"

const mac = process.env.HUMI_MAC ?? "EC:0F:01:46:10:4A"

// Talks to the real meter, so it only runs with HUMI_LIVE=1. Needs
// `humi setup-bluetooth` once and the meter in range.
describe.skipIf(process.env.HUMI_LIVE !== "1")("SwitchBot meter (live)", () => {
  test("waits for a real measurement", async () => {
    // The meter is not paired, so this only drops BlueZ's cached
    // advertisement; whatever we decode below was received during the test.
    Bun.spawnSync(["bluetoothctl", "remove", mac])

    const measurement = await Effect.gen(function* waitForMeasurement() {
      const bluetooth = yield* Bluetooth
      return yield* bluetooth.info(mac).pipe(
        Effect.map((text) => decodeOutdoorMeter(parseInfo(text))),
        Effect.repeat({
          schedule: Schedule.spaced("1 second"),
          until: Option.isSome,
        }),
        Effect.map(Option.getOrThrow)
      )
    }).pipe(
      Effect.provide(Bluetooth.layer),
      Effect.provide(BunServices.layer),
      Effect.scoped,
      Effect.runPromise
    )

    expect(measurement.temperature).toBeGreaterThan(-40)
    expect(measurement.temperature).toBeLessThan(60)
    expect(measurement.humidity).toBeGreaterThanOrEqual(0)
    expect(measurement.humidity).toBeLessThanOrEqual(100)
    expect(
      measurement.raw.startsWith(mac.replaceAll(":", "").toLowerCase())
    ).toBe(true)
  }, 60_000)
})
