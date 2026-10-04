import { Context, Effect, Layer, Schema } from "effect"
import { Model } from "effect/schema"
import { SqlClient, SqlModel, SqlSchema } from "effect/sql"

import type { Measurement } from "../switchbot.ts"

/** A stored sensor reading. */
export class Reading extends Model.Class<Reading>("Reading")({
  id: Model.Field({
    select: Schema.Int,
    update: Schema.Int,
  }),
  mac: Schema.String,
  temperature: Schema.Number,
  humidity: Schema.Int,
  /** Battery as of the latest daily check; null until the first one. */
  battery: Schema.NullOr(Schema.Int),
  rssi: Schema.NullOr(Schema.Int),
  raw: Schema.String,
  recorded_at: Model.DateTimeInsert,
}) {}

/** Counts over the stored readings. */
export const Summary = Schema.Struct({
  total: Schema.Int,
  distinct: Schema.Int,
})

/** Storage for sensor readings. */
export class Readings extends Context.Service<
  Readings,
  {
    readonly insert: (
      mac: string,
      measurement: Measurement,
      battery: number | null
    ) => Effect.Effect<Reading>
    readonly latest: (limit: number) => Effect.Effect<readonly Reading[]>
    readonly summary: (since: string) => Effect.Effect<typeof Summary.Type>
  }
>()("humi/db/Readings") {
  static readonly layer = Layer.effect(
    Readings,
    Effect.gen(function* readingsLayer() {
      const sql = yield* SqlClient.SqlClient

      const repo = yield* SqlModel.makeRepository(Reading, {
        tableName: "readings",
        spanPrefix: "Readings",
        idColumn: "id",
      })

      const findLatest = SqlSchema.findAll({
        Request: Schema.Int,
        Result: Reading,
        execute: (limit) =>
          sql`SELECT * FROM readings ORDER BY id DESC LIMIT ${limit}`,
      })

      // `distinct` counts advertisements whose payload actually changed.
      const findSummary = SqlSchema.findOne({
        Request: Schema.String,
        Result: Summary,
        execute: (since) =>
          sql`
            SELECT COUNT(*) AS total, COUNT(DISTINCT raw) AS "distinct"
            FROM readings WHERE recorded_at >= ${since}
          `,
      })

      const insert: (
        mac: string,
        measurement: Measurement,
        battery: number | null
      ) => Effect.Effect<Reading> = Effect.fn("Readings.insert")(
        function* insert(
          mac: string,
          measurement: Measurement,
          battery: number | null
        ) {
          const row = yield* Reading.insert.makeEffect({
            mac,
            temperature: measurement.temperature,
            humidity: measurement.humidity,
            battery,
            rssi: measurement.rssi,
            raw: measurement.raw,
          })
          return yield* repo.insert(row)
        },
        Effect.orDie
      )

      const latest: (limit: number) => Effect.Effect<readonly Reading[]> =
        Effect.fn("Readings.latest")(function* latest(limit: number) {
          return yield* findLatest(limit)
        }, Effect.orDie)

      const summary: (since: string) => Effect.Effect<typeof Summary.Type> =
        Effect.fn("Readings.summary")(function* summary(since: string) {
          return yield* findSummary(since)
        }, Effect.orDie)

      return Readings.of({ insert, latest, summary })
    })
  )
}
