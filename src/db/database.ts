import path from "node:path"

import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-bun"
import { Effect, FileSystem, Layer } from "effect"
import { SqlClient } from "effect/sql"

const dataHome =
  process.env.XDG_DATA_HOME ?? path.join(process.env.HOME ?? "", ".local/share")

/** Directory holding humi's SQLite database. */
export const dataDirectory = path.join(dataHome, "humi")

/** Path to humi's SQLite database file. */
export const databasePath = path.join(dataDirectory, "humi.sqlite")

/**
 * Every table's `recorded_at`: set by SQLite on insert, as an ISO 8601 UTC
 * timestamp with milliseconds (`2026-10-04T09:40:00.123Z`), so all tables
 * share one clock and one format.
 */
const recordedAt =
  "recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))"

// One table per kind of scan: they carry different data at different times.
const migrations = SqliteMigrator.layer({
  loader: SqliteMigrator.fromRecord({
    "0001_create_readings": Effect.gen(function* createReadingTables() {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        CREATE TABLE passive_readings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          mac TEXT NOT NULL,
          temperature REAL NOT NULL,
          humidity INTEGER NOT NULL,
          rssi INTEGER,
          raw TEXT NOT NULL,
          ${sql.literal(recordedAt)}
        )
      `
      yield* sql`
        CREATE TABLE active_readings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          mac TEXT NOT NULL,
          battery INTEGER NOT NULL,
          ${sql.literal(recordedAt)}
        )
      `
    }),
  }),
})

/** Layer providing a migrated SQLite client for the given database file. */
export const layerWith = (filename: string) =>
  migrations.pipe(
    Layer.provideMerge(SqliteClient.layer({ filename, create: true }))
  )

/** Layer providing humi's on-disk database, creating the data directory. */
export const layer = Layer.unwrap(
  Effect.gen(function* humiDatabaseLayer() {
    const fs = yield* FileSystem.FileSystem
    yield* fs.makeDirectory(dataDirectory, { recursive: true })
    return layerWith(databasePath)
  })
)
