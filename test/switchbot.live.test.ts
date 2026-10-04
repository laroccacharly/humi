import { describe, expect, test } from "bun:test"

import { BunServices } from "@effect/platform-bun"
import { DateTime, Effect, Layer, Option, Schedule } from "effect"

import { Bluetooth } from "../src/bluetooth.ts"
import { recordActiveScan, recordPassiveScan } from "../src/collector.ts"
import { loadConfig } from "../src/config.ts"
import { layerWith } from "../src/db/database.ts"
import { Readings } from "../src/db/readings.ts"
import { findSwitchbots } from "../src/discover.ts"

/** Real Bluetooth, and a fresh in-memory database per test. */
const runLive = async <A, E>(
  effect: Effect.Effect<A, E, Bluetooth | Readings | BunServices.BunServices>
) =>
  await effect.pipe(
    Effect.provide(
      Layer.mergeAll(
        Bluetooth.layer,
        Readings.layer.pipe(Layer.provide(layerWith(":memory:")))
      )
    ),
    Effect.provide(BunServices.layer),
    Effect.scoped,
    Effect.runPromise
  )

const configuredMac = async () =>
  await loadConfig.pipe(
    Effect.map((config) => config.mac),
    Effect.provide(BunServices.layer),
    Effect.runPromise
  )

/** Whether SQLite stamped the row just now. */
const isRecent = (recordedAt: DateTime.Utc) =>
  Math.abs(DateTime.toEpochMillis(recordedAt) - Date.now()) < 60_000

// Talks to the real meter, so it only runs with HUMI_LIVE=1. Needs
// `humi setup-bluetooth` once and the meter from `humi config` in range.
describe.skipIf(process.env.HUMI_LIVE !== "1")("SwitchBot meter (live)", () => {
  test("passive scan records a passive reading", async () => {
    const mac = await configuredMac()
    const { stored, passive, active } = await runLive(
      Effect.gen(function* recordPassive() {
        const bluetooth = yield* Bluetooth
        const readings = yield* Readings
        // Whatever gets recorded below was received during the test.
        yield* bluetooth.forget(mac)
        const reading = yield* recordPassiveScan(mac).pipe(
          Effect.repeat({
            schedule: Schedule.spaced("1 second"),
            until: Option.isSome,
          }),
          Effect.map(Option.getOrThrow)
        )
        return {
          stored: reading,
          passive: yield* readings.latestPassive(10),
          active: yield* readings.latestActive(10),
        }
      })
    )

    expect(passive.map((row) => row.id)).toEqual([stored.id])
    expect(active).toEqual([])
    expect(stored.mac).toBe(mac)
    expect(stored.temperature).toBeGreaterThan(-40)
    expect(stored.temperature).toBeLessThan(60)
    expect(stored.humidity).toBeGreaterThanOrEqual(0)
    expect(stored.humidity).toBeLessThanOrEqual(100)
    expect(stored.raw.startsWith(mac.replaceAll(":", "").toLowerCase())).toBe(
      true
    )
    expect(isRecent(stored.recorded_at)).toBe(true)
  }, 20_000)

  test("active scan records an active reading", async () => {
    const mac = await configuredMac()
    const { stored, passive, active } = await runLive(
      Effect.gen(function* recordActive() {
        const bluetooth = yield* Bluetooth
        const readings = yield* Readings
        // The passive scan never receives the battery, but a past active scan
        // may have left it in BlueZ's cache.
        yield* bluetooth.forget(mac)
        // The meter answers scan requests only now and then, so short scans
        // are repeated until it does.
        const reading = yield* recordActiveScan(mac, 5).pipe(
          Effect.repeat({ until: Option.isSome }),
          Effect.map(Option.getOrThrow)
        )
        return {
          stored: reading,
          passive: yield* readings.latestPassive(10),
          active: yield* readings.latestActive(10),
        }
      })
    )

    expect(active.map((row) => row.id)).toEqual([stored.id])
    expect(passive).toEqual([])
    expect(stored.mac).toBe(mac)
    expect(stored.battery).toBeGreaterThan(0)
    expect(stored.battery).toBeLessThanOrEqual(100)
    expect(isRecent(stored.recorded_at)).toBe(true)
  }, 30_000)

  test("finds the configured meter with `humi bluetooth ls`", async () => {
    const mac = await configuredMac()
    // BlueZ's cache counts too: this checks that we can find the meter, the
    // tests above check that its advertisements are fresh.
    const found = await runLive(findSwitchbots(5))

    const meter = found.find((device) => device.mac === mac)
    expect(meter).toBeDefined()
    expect(Option.isSome(meter?.measurement ?? Option.none())).toBe(true)
  }, 10_000)
})
