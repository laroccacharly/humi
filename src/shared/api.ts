import { Schema } from "effect"

/** How far back `GET /api/readings` looks. */
export const uiDays = 14

/** What `GET /api/readings` returns, oldest first; `t` is epoch millis. */
export const ReadingsResponse = Schema.Struct({
  passive: Schema.Array(
    Schema.Struct({
      t: Schema.Number,
      temperature: Schema.Number,
      humidity: Schema.Number,
    })
  ),
  plug: Schema.Array(Schema.Struct({ t: Schema.Number, watts: Schema.Number })),
  active: Schema.Array(
    Schema.Struct({ t: Schema.Number, battery: Schema.Number })
  ),
})

/** Decodes a `GET /api/readings` body. */
export const decodeReadings = Schema.decodeUnknownEffect(ReadingsResponse)
