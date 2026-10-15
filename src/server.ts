import path from "node:path"

import type { Scope } from "effect"
import { DateTime, Duration, Effect } from "effect"

import { Readings } from "./db/readings.ts"
import type { ReadingsResponse } from "./shared/api.ts"

const uiRoot = path.join(import.meta.dir, "ui")

/** Where the Vite build of the UI goes, at the repository root. */
const uiDirectory = path.join(import.meta.dir, "..", "dist-ui")

/**
 * Builds the UI with Vite into `uiDirectory`, once per process: the first
 * server start pays for it, later ones (tests) reuse it.
 */
const buildUi = Effect.runSync(
  Effect.cached(
    Effect.gen(function* buildUi() {
      yield* Effect.logInfo("Building the UI...")
      yield* Effect.promise(async () => {
        const { build } = await import("vite")
        await build({
          configFile: false,
          root: uiRoot,
          logLevel: "warn",
          // ECharts alone is past Vite's 500 kB warning; fine on a LAN.
          build: {
            outDir: uiDirectory,
            emptyOutDir: true,
            chunkSizeWarningLimit: 1500,
          },
        })
      })
      yield* Effect.logInfo("UI build complete")
    })
  )
)

/** Answers with the built UI's files, refusing paths that leave it. */
const serveUi = async (request: Request) => {
  const { pathname } = new URL(request.url)
  const filePath = path.resolve(
    uiDirectory,
    `.${pathname === "/" ? "/index.html" : pathname}`
  )
  const file = Bun.file(filePath)
  // Revalidate each load, so a rebuild's new hashed bundle is picked up.
  return filePath.startsWith(uiDirectory + path.sep) && (await file.exists())
    ? new Response(file, { headers: { "Cache-Control": "no-cache" } })
    : new Response("Not found", { status: 404 })
}

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
  const plug = yield* readings.plugSince(since)
  const active = yield* readings.activeSince(since)
  return {
    passive: passive.map((row) => ({
      t: DateTime.toEpochMillis(row.recorded_at),
      temperature: row.temperature,
      humidity: row.humidity,
    })),
    plug: plug.map((row) => ({
      t: DateTime.toEpochMillis(row.recorded_at),
      watts: row.watts,
    })),
    active: active.map((row) => ({
      t: DateTime.toEpochMillis(row.recorded_at),
      battery: row.battery,
    })),
  }
})

/**
 * Serves the UI on `port` (0 picks a free one) until the scope closes. The
 * UI is built from source first, so each start serves the current code.
 */
export const serve: (
  port: number
) => Effect.Effect<URL, never, Readings | Scope.Scope> = Effect.fn("serve")(
  function* serve(port: number) {
    yield* buildUi
    const context = yield* Effect.context<Readings>()
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          port,
          development: false,
          routes: {
            "/api/readings": async () =>
              Response.json(
                await Effect.runPromiseWith(context)(recentReadings)
              ),
          },
          fetch: serveUi,
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
