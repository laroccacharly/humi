import { Context, Effect, Layer, Schema } from "effect"
import { Model } from "effect/schema"
import { SqlClient, SqlModel, SqlSchema } from "effect/sql"

import type { Measurement } from "../switchbot.ts"

// SQLite fills both in on insert; see `recordedAt` in database.ts.
const id = Model.Field({ select: Schema.Int, update: Schema.Int })
const recordedAt = Model.GeneratedByDb(Schema.DateTimeUtcFromString)

/** What a passive scan heard: the meter's regular broadcast. */
export class PassiveReading extends Model.Class<PassiveReading>(
  "PassiveReading"
)({
  id,
  mac: Schema.String,
  temperature: Schema.Number,
  humidity: Schema.Int,
  rssi: Schema.NullOr(Schema.Int),
  raw: Schema.String,
  recorded_at: recordedAt,
}) {}

/** What an active scan got back: the scan response with the battery. */
export class ActiveReading extends Model.Class<ActiveReading>("ActiveReading")({
  id,
  mac: Schema.String,
  battery: Schema.Int,
  recorded_at: recordedAt,
}) {}

/** Counts over the readings recorded since a given time. */
export const Summary = Schema.Struct({
  passive: Schema.Int,
  /** Passive readings whose advertisement payload actually changed. */
  distinct: Schema.Int,
  active: Schema.Int,
})

/** Storage for passive and active readings, one table each. */
export class Readings extends Context.Service<
  Readings,
  {
    readonly insertPassive: (
      mac: string,
      measurement: Measurement
    ) => Effect.Effect<PassiveReading>
    readonly insertActive: (
      mac: string,
      battery: number
    ) => Effect.Effect<ActiveReading>
    readonly latestPassive: (
      limit: number
    ) => Effect.Effect<readonly PassiveReading[]>
    readonly latestActive: (
      limit: number
    ) => Effect.Effect<readonly ActiveReading[]>
    readonly summary: (since: string) => Effect.Effect<typeof Summary.Type>
  }
>()("humi/db/Readings") {
  static readonly layer = Layer.effect(
    Readings,
    Effect.gen(function* readingsLayer() {
      const sql = yield* SqlClient.SqlClient

      const passiveRepo = yield* SqlModel.makeRepository(PassiveReading, {
        tableName: "passive_readings",
        spanPrefix: "PassiveReadings",
        idColumn: "id",
      })
      const activeRepo = yield* SqlModel.makeRepository(ActiveReading, {
        tableName: "active_readings",
        spanPrefix: "ActiveReadings",
        idColumn: "id",
      })

      const findLatestPassive = SqlSchema.findAll({
        Request: Schema.Int,
        Result: PassiveReading,
        execute: (limit) =>
          sql`SELECT * FROM passive_readings ORDER BY id DESC LIMIT ${limit}`,
      })
      const findLatestActive = SqlSchema.findAll({
        Request: Schema.Int,
        Result: ActiveReading,
        execute: (limit) =>
          sql`SELECT * FROM active_readings ORDER BY id DESC LIMIT ${limit}`,
      })
      const findSummary = SqlSchema.findOne({
        Request: Schema.String,
        Result: Summary,
        execute: (since) =>
          sql`
            SELECT
              (SELECT COUNT(*) FROM passive_readings
                WHERE recorded_at >= ${since}) AS passive,
              (SELECT COUNT(DISTINCT raw) FROM passive_readings
                WHERE recorded_at >= ${since}) AS "distinct",
              (SELECT COUNT(*) FROM active_readings
                WHERE recorded_at >= ${since}) AS active
          `,
      })

      const insertPassive: (
        mac: string,
        measurement: Measurement
      ) => Effect.Effect<PassiveReading> = Effect.fn("Readings.insertPassive")(
        function* insertPassive(mac: string, measurement: Measurement) {
          const row = yield* PassiveReading.insert.makeEffect({
            mac,
            temperature: measurement.temperature,
            humidity: measurement.humidity,
            rssi: measurement.rssi,
            raw: measurement.raw,
          })
          return yield* passiveRepo.insert(row)
        },
        Effect.orDie
      )

      const insertActive: (
        mac: string,
        battery: number
      ) => Effect.Effect<ActiveReading> = Effect.fn("Readings.insertActive")(
        function* insertActive(mac: string, battery: number) {
          const row = yield* ActiveReading.insert.makeEffect({ mac, battery })
          return yield* activeRepo.insert(row)
        },
        Effect.orDie
      )

      const latestPassive: (
        limit: number
      ) => Effect.Effect<readonly PassiveReading[]> = Effect.fn(
        "Readings.latestPassive"
      )(function* latestPassive(limit: number) {
        return yield* findLatestPassive(limit)
      }, Effect.orDie)

      const latestActive: (
        limit: number
      ) => Effect.Effect<readonly ActiveReading[]> = Effect.fn(
        "Readings.latestActive"
      )(function* latestActive(limit: number) {
        return yield* findLatestActive(limit)
      }, Effect.orDie)

      const summary: (since: string) => Effect.Effect<typeof Summary.Type> =
        Effect.fn("Readings.summary")(function* summary(since: string) {
          return yield* findSummary(since)
        }, Effect.orDie)

      return Readings.of({
        insertPassive,
        insertActive,
        latestPassive,
        latestActive,
        summary,
      })
    })
  )
}
