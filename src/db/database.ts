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

const migrations = SqliteMigrator.layer({
  loader: SqliteMigrator.fromRecord({
    "0001_create_readings": Effect.gen(function* createReadingsTable() {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        CREATE TABLE readings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          mac TEXT NOT NULL,
          temperature REAL NOT NULL,
          humidity INTEGER NOT NULL,
          battery INTEGER NOT NULL,
          rssi INTEGER,
          raw TEXT NOT NULL,
          recorded_at TEXT NOT NULL
        )
      `
    }),
    // The battery now comes from a daily active scan, so it can be unknown.
    "0002_nullable_battery": Effect.gen(function* nullableBattery() {
      const sql = yield* SqlClient.SqlClient
      yield* sql`ALTER TABLE readings RENAME TO readings_old`
      yield* sql`
        CREATE TABLE readings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          mac TEXT NOT NULL,
          temperature REAL NOT NULL,
          humidity INTEGER NOT NULL,
          battery INTEGER,
          rssi INTEGER,
          raw TEXT NOT NULL,
          recorded_at TEXT NOT NULL
        )
      `
      yield* sql`INSERT INTO readings SELECT * FROM readings_old`
      yield* sql`DROP TABLE readings_old`
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
