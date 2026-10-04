import type { Scope } from "effect"
import { DateTime, Duration, Effect } from "effect"

import { Readings } from "./db/readings.ts"
import type { ReadingsResponse } from "./ui/api.ts"
import index from "./ui/index.html"

/** How far back the UI looks. */
export const uiDays = 14

/** The last `uiDays` of readings, as the UI wants them. */
const recentReadings: Effect.Effect<
  typeof ReadingsResponse.Type,
  never,
  Readings
> = Effect.gen(function* recentReadings() {
  const readings = yield* Readings
  const since = DateTime.formatIso(
    DateTime.subtractDuration(yield* DateTime.now, Duration.days(uiDays))
  )
  const passive = yield* readings.passiveSince(since)
  const active = yield* readings.activeSince(since)
  return {
    passive: passive.map((row) => ({
      t: DateTime.toEpochMillis(row.recorded_at),
      temperature: row.temperature,
      humidity: row.humidity,
    })),
    active: active.map((row) => ({
      t: DateTime.toEpochMillis(row.recorded_at),
      battery: row.battery,
    })),
  }
})

/**
 * Serves the UI on `port` (0 picks a free one) until the scope closes. Bun
 * bundles the UI from source, so each start serves the current code.
 */
export const serve: (
  port: number
) => Effect.Effect<URL, never, Readings | Scope.Scope> = Effect.fn("serve")(
  function* serve(port: number) {
    const context = yield* Effect.context<Readings>()
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          port,
          development: false,
          routes: {
            "/": index,
            "/api/readings": async () =>
              Response.json(
                await Effect.runPromiseWith(context)(recentReadings)
              ),
          },
        })
      ),
      (running) =>
        Effect.promise(async () => {
          await running.stop(true)
        })
    )
    yield* Effect.logInfo(`UI on ${server.url.href}`)
    return server.url
  }
)
