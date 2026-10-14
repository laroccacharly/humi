import { BunServices } from "@effect/platform-bun"
import { Effect, Layer } from "effect"
import { SqlClient } from "effect/sql"

import { layerWith } from "../src/db/database.ts"
import { Readings } from "../src/db/readings.ts"
import { serve } from "../src/server.ts"

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
    INSERT INTO plug_readings (mac, is_on, watts, rssi, raw, recorded_at)
    VALUES ('D8:3B:DA:11:C1:4A', 1, 40, -60, 'plug', ${new Date(now - hour).toISOString()})
  `
  yield* sql`
    INSERT INTO active_readings (mac, battery, recorded_at)
    VALUES (${mac}, 97, ${new Date(now - 2 * hour).toISOString()})
  `
})

/** Starts the UI server on a free port over the seeded database. */
export const withServer = async <A>(use: (url: URL) => Promise<A>) =>
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
