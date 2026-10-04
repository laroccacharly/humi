import { expect, test } from "bun:test"

import { BunServices } from "@effect/platform-bun"
import { Effect, Layer } from "effect"
import { SqlClient } from "effect/sql"

import { layerWith } from "../src/db/database.ts"
import { Readings } from "../src/db/readings.ts"
import { serve } from "../src/server.ts"
import { decodeReadings } from "../src/ui/api.ts"

const mac = "EC:0F:01:46:10:4A"
const hour = 3_600_000

/** A day of fake hourly readings, and one from before the UI's window. */
const seed = Effect.gen(function* seed() {
  const sql = yield* SqlClient.SqlClient
  const now = Date.now()
  for (let i = 0; i < 24; i += 1) {
    const at = new Date(now - i * hour).toISOString()
    yield* sql`
      INSERT INTO passive_readings (mac, temperature, humidity, rssi, raw, recorded_at)
      VALUES (${mac}, ${18 + Math.sin(i / 4) * 3}, ${45 + i}, -60, ${`raw${i}`}, ${at})
    `
  }
  const old = new Date(now - 30 * 24 * hour).toISOString()
  yield* sql`
    INSERT INTO passive_readings (mac, temperature, humidity, rssi, raw, recorded_at)
    VALUES (${mac}, 99, 99, -60, 'old', ${old})
  `
  yield* sql`
    INSERT INTO active_readings (mac, battery, recorded_at)
    VALUES (${mac}, 97, ${new Date(now - 2 * hour).toISOString()})
  `
})

/** Starts the server on a free port over the seeded database. */
const withServer = async <A>(use: (url: URL) => Promise<A>) =>
  await Effect.gen(function* serveSeeded() {
    yield* seed
    const url = yield* serve(0)
    return yield* Effect.promise(async () => await use(url))
  }).pipe(
    Effect.scoped,
    Effect.provide(
      Readings.layer.pipe(Layer.provideMerge(layerWith(":memory:")))
    ),
    Effect.provide(BunServices.layer),
    Effect.runPromise
  )

test("serves the UI page", async () => {
  const { status, html } = await withServer(async (url) => {
    const page = await fetch(url)
    return { status: page.status, html: await page.text() }
  })
  // Bun bundles the UI on this first request and answers 500 if it fails.
  expect(status).toBe(200)
  expect(html).toContain("<title>humi</title>")
})

test("serves the last 14 days of readings, oldest first", async () => {
  const body = await withServer(async (url) => {
    const response = await fetch(new URL("/api/readings", url))
    const json: unknown = await response.json()
    return json
  })
  const data = await Effect.runPromise(decodeReadings(body))
  expect(data.passive).toHaveLength(24)
  expect(data.passive.map((row) => row.humidity)).not.toContain(99)
  expect(data.passive.at(-1)?.humidity).toBe(45)
  expect(data.active.map((row) => row.battery)).toEqual([97])
})
