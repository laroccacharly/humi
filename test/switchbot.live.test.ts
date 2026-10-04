import { describe, expect, test } from "bun:test"

import { BunServices } from "@effect/platform-bun"
import { Effect, Option, Schedule } from "effect"

import { Bluetooth } from "../src/bluetooth.ts"
import { loadConfig } from "../src/config.ts"
import { findSwitchbots } from "../src/discover.ts"
import { decodeOutdoorMeter, parseInfo } from "../src/switchbot.ts"

// Talks to the real meter, so it only runs with HUMI_LIVE=1. Needs
// `humi setup-bluetooth` once and the meter from `humi config` in range.
describe.skipIf(process.env.HUMI_LIVE !== "1")("SwitchBot meter (live)", () => {
  test("waits for a real measurement", async () => {
    const { mac } = await loadConfig.pipe(
      Effect.provide(BunServices.layer),
      Effect.runPromise
    )
    const measurement = await Effect.gen(function* waitForMeasurement() {
      const bluetooth = yield* Bluetooth
      // Whatever we decode below was received during the test.
      yield* bluetooth.forget(mac)
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
  }, 10_000)

  test("finds the configured meter with `humi bluetooth ls`", async () => {
    const { mac } = await loadConfig.pipe(
      Effect.provide(BunServices.layer),
      Effect.runPromise
    )
    // BlueZ's cache counts too: this checks that we can find the meter, the
    // test above checks that its advertisements are fresh.
    const found = await findSwitchbots(5).pipe(
      Effect.provide(Bluetooth.layer),
      Effect.provide(BunServices.layer),
      Effect.scoped,
      Effect.runPromise
    )

    const meter = found.find((device) => device.mac === mac)
    expect(meter).toBeDefined()
    expect(Option.isSome(meter?.measurement ?? Option.none())).toBe(true)
  }, 10_000)
})
