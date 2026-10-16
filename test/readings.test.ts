import { expect, test } from "bun:test"

import { BunServices } from "@effect/platform-bun"
import { DateTime, Effect, Layer } from "effect"
import { SqlClient } from "effect/sql"

import { layerWith } from "../src/db/database.ts"
import { Readings } from "../src/db/readings.ts"
import { Measurement } from "../src/switchbot.ts"

const runWithDatabase = async <A, E>(
  effect: Effect.Effect<A, E, Readings | SqlClient.SqlClient>
) =>
  await effect.pipe(
    Effect.provide(
      Readings.layer.pipe(Layer.provideMerge(layerWith(":memory:")))
    ),
    Effect.provide(BunServices.layer),
    Effect.runPromise
  )

const measurement = new Measurement({
  temperature: 18.1,
  humidity: 45,
  rssi: -54,
  raw: "c0ffee123456130208972200",
})

test("passive and active readings go to their own tables", async () => {
  const { passive, active } = await runWithDatabase(
    Effect.gen(function* insertBoth() {
      const readings = yield* Readings
      yield* readings.insertPassive("C0:FF:EE:12:34:56", measurement)
      yield* readings.insertActive("C0:FF:EE:12:34:56", 100)
      return {
        passive: yield* readings.latestPassive(10),
        active: yield* readings.latestActive(10),
      }
    })
  )
  expect(passive.map((row) => [row.temperature, row.humidity])).toEqual([
    [18.1, 45],
  ])
  expect(active.map((row) => row.battery)).toEqual([100])
})

test("SQLite stamps both tables with the same ISO format", async () => {
  const stamps = await runWithDatabase(
    Effect.gen(function* readStamps() {
      const readings = yield* Readings
      const sql = yield* SqlClient.SqlClient
      yield* readings.insertPassive("C0:FF:EE:12:34:56", measurement)
      yield* readings.insertActive("C0:FF:EE:12:34:56", 100)
      return yield* sql<{ readonly recorded_at: string }>`
        SELECT recorded_at FROM passive_readings
        UNION ALL SELECT recorded_at FROM active_readings
      `
    })
  )
  expect(stamps).toHaveLength(2)
  for (const { recorded_at } of stamps) {
    expect(recorded_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u)
    expect(
      Math.abs(
        DateTime.toEpochMillis(DateTime.makeUnsafe(recorded_at)) - Date.now()
      )
    ).toBeLessThan(60_000)
  }
})
