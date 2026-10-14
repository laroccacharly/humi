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
  temperature: Schema.Number,
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
  watts: Schema.Number,
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

      const findLatestPassive = SqlSchema.findAll({
        Request: Schema.Int,
        Result: PassiveReading,
        execute: (limit) =>
          sql`SELECT * FROM passive_readings ORDER BY id DESC LIMIT ${limit}`,
      })
      const findLatestPlug = SqlSchema.findAll({
        Request: Schema.Int,
        Result: PlugReading,
        execute: (limit) =>
          sql`SELECT * FROM plug_readings ORDER BY id DESC LIMIT ${limit}`,
      })
      const findLatestActive = SqlSchema.findAll({
        Request: Schema.Int,
        Result: ActiveReading,
        execute: (limit) =>
          sql`SELECT * FROM active_readings ORDER BY id DESC LIMIT ${limit}`,
      })
      const findPassiveSince = SqlSchema.findAll({
        Request: Schema.String,
        Result: PassiveReading,
        execute: (since) =>
          sql`SELECT * FROM passive_readings WHERE recorded_at >= ${since} ORDER BY recorded_at`,
      })
      const findActiveSince = SqlSchema.findAll({
        Request: Schema.String,
        Result: ActiveReading,
        execute: (since) =>
          sql`SELECT * FROM active_readings WHERE recorded_at >= ${since} ORDER BY recorded_at`,
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

      const insertPlug: (
        mac: string,
        status: PlugStatus
      ) => Effect.Effect<PlugReading> = Effect.fn("Readings.insertPlug")(
        function* insertPlug(mac: string, status: PlugStatus) {
          const row = yield* PlugReading.insert.makeEffect({
            mac,
            is_on: status.on,
            watts: status.watts,
            rssi: status.rssi,
            raw: status.raw,
          })
          return yield* plugRepo.insert(row)
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

      const latestPlug: (
        limit: number
      ) => Effect.Effect<readonly PlugReading[]> = Effect.fn(
        "Readings.latestPlug"
      )(function* latestPlug(limit: number) {
        return yield* findLatestPlug(limit)
      }, Effect.orDie)

      const latestActive: (
        limit: number
      ) => Effect.Effect<readonly ActiveReading[]> = Effect.fn(
        "Readings.latestActive"
      )(function* latestActive(limit: number) {
        return yield* findLatestActive(limit)
      }, Effect.orDie)

      const passiveSince: (
        since: string
      ) => Effect.Effect<readonly PassiveReading[]> = Effect.fn(
        "Readings.passiveSince"
      )(function* passiveSince(since: string) {
        return yield* findPassiveSince(since)
      }, Effect.orDie)

      const activeSince: (
        since: string
      ) => Effect.Effect<readonly ActiveReading[]> = Effect.fn(
        "Readings.activeSince"
      )(function* activeSince(since: string) {
        return yield* findActiveSince(since)
      }, Effect.orDie)

      const summary: (since: string) => Effect.Effect<typeof Summary.Type> =
        Effect.fn("Readings.summary")(function* summary(since: string) {
          return yield* findSummary(since)
        }, Effect.orDie)

      return Readings.of({
        insertPassive,
        insertPlug,
        insertActive,
        latestPassive,
        latestPlug,
        latestActive,
        passiveSince,
        activeSince,
        summary,
      })
    })
  )
}
