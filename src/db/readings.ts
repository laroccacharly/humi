import { Context, Effect, Layer, Schema } from "effect"
import { Model } from "effect/schema"
import { SqlClient, SqlModel, SqlSchema } from "effect/sql"

import type { Measurement, PlugStatus } from "../switchbot.ts"

// SQLite fills both in on insert; see `recordedAt` in database.ts.
const id = Model.Field({ select: Schema.Int, update: Schema.Int })
const recordedAt = Model.GeneratedByDb(Schema.DateTimeUtcFromString)

/** What a passive scan heard: the meter's regular broadcast. */
export class PassiveReading extends Model.Class<PassiveReading>(
  "PassiveReading"
)({
  id,
  mac: Schema.String,
  temperature: Schema.Finite,
  humidity: Schema.Int,
  rssi: Schema.NullOr(Schema.Int),
  raw: Schema.String,
  recorded_at: recordedAt,
}) {}

/** What the plug broadcast: its on/off state and power. */
export class PlugReading extends Model.Class<PlugReading>("PlugReading")({
  id,
  mac: Schema.String,
  is_on: Schema.BooleanFromBit,
  watts: Schema.Finite,
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
  plug: Schema.Int,
  active: Schema.Int,
})

/** Storage for passive, plug and active readings, one table each. */
export class Readings extends Context.Service<
  Readings,
  {
    readonly insertPassive: (
      mac: string,
      measurement: Measurement
    ) => Effect.Effect<PassiveReading>
    readonly insertPlug: (
      mac: string,
      status: PlugStatus
    ) => Effect.Effect<PlugReading>
    readonly insertActive: (
      mac: string,
      battery: number
    ) => Effect.Effect<ActiveReading>
    readonly latestPassive: (
      limit: number
    ) => Effect.Effect<readonly PassiveReading[]>
    readonly latestPlug: (
      limit: number
    ) => Effect.Effect<readonly PlugReading[]>
    readonly latestActive: (
      limit: number
    ) => Effect.Effect<readonly ActiveReading[]>
    readonly passiveSince: (
      since: string
    ) => Effect.Effect<readonly PassiveReading[]>
    readonly plugSince: (since: string) => Effect.Effect<readonly PlugReading[]>
    readonly activeSince: (
      since: string
    ) => Effect.Effect<readonly ActiveReading[]>
    readonly summary: (since: string) => Effect.Effect<typeof Summary.Type>
  }
>()("humi/db/Readings") {
  static readonly layer = Layer.effect(
    Readings,
    Effect.gen(function* readingsLayer() {
      const sql = yield* SqlClient.SqlClient

      /** The latest rows of `table`, and those recorded since a time. */
      const queries = <Row extends Schema.Constraint>(
        table: string,
        row: Row
      ) => {
        const findLatest = SqlSchema.findAll({
          Request: Schema.Int,
          Result: row,
          execute: (limit) =>
            sql`SELECT * FROM ${sql(table)} ORDER BY id DESC LIMIT ${limit}`,
        })
        const findSince = SqlSchema.findAll({
          Request: Schema.String,
          Result: row,
          execute: (since) =>
            sql`SELECT * FROM ${sql(table)} WHERE recorded_at >= ${since} ORDER BY recorded_at`,
        })
        const attributes = { attributes: { table } }
        return {
          latest: (limit: number) =>
            findLatest(limit).pipe(
              Effect.orDie,
              Effect.withSpan("Readings.latest", attributes)
            ),
          since: (since: string) =>
            findSince(since).pipe(
              Effect.orDie,
              Effect.withSpan("Readings.since", attributes)
            ),
        }
      }

      const passive = queries("passive_readings", PassiveReading)
      const plug = queries("plug_readings", PlugReading)
      const active = queries("active_readings", ActiveReading)

      const passiveRepo = yield* SqlModel.makeRepository(PassiveReading, {
        tableName: "passive_readings",
        spanPrefix: "PassiveReadings",
        idColumn: "id",
      })
      const plugRepo = yield* SqlModel.makeRepository(PlugReading, {
        tableName: "plug_readings",
        spanPrefix: "PlugReadings",
        idColumn: "id",
      })
      const activeRepo = yield* SqlModel.makeRepository(ActiveReading, {
        tableName: "active_readings",
        spanPrefix: "ActiveReadings",
        idColumn: "id",
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
              (SELECT COUNT(*) FROM plug_readings
                WHERE recorded_at >= ${since}) AS plug,
              (SELECT COUNT(*) FROM active_readings
                WHERE recorded_at >= ${since}) AS active
          `,
      })

      return Readings.of({
        insertPassive: (mac, measurement) =>
          PassiveReading.insert
            .makeEffect({
              mac,
              temperature: measurement.temperature,
              humidity: measurement.humidity,
              rssi: measurement.rssi,
              raw: measurement.raw,
            })
            .pipe(Effect.flatMap(passiveRepo.insert), Effect.orDie),
        insertPlug: (mac, status) =>
          PlugReading.insert
            .makeEffect({
              mac,
              is_on: status.on,
              watts: status.watts,
              rssi: status.rssi,
              raw: status.raw,
            })
            .pipe(Effect.flatMap(plugRepo.insert), Effect.orDie),
        insertActive: (mac, battery) =>
          ActiveReading.insert
            .makeEffect({ mac, battery })
            .pipe(Effect.flatMap(activeRepo.insert), Effect.orDie),
        latestPassive: passive.latest,
        latestPlug: plug.latest,
        latestActive: active.latest,
        passiveSince: passive.since,
        plugSince: plug.since,
        activeSince: active.since,
        summary: (since) =>
          findSummary(since).pipe(
            Effect.orDie,
            Effect.withSpan("Readings.summary")
          ),
      })
    })
  )
}
