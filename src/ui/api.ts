import { Schema } from "effect"

/** What `GET /api/readings` returns, oldest first; `t` is epoch millis. */
export const ReadingsResponse = Schema.Struct({
  passive: Schema.Array(
    Schema.Struct({
      t: Schema.Number,
      temperature: Schema.Number,
      humidity: Schema.Number,
    })
  ),
  active: Schema.Array(
    Schema.Struct({ t: Schema.Number, battery: Schema.Number })
  ),
})

/** Decodes a `GET /api/readings` body. */
export const decodeReadings = Schema.decodeUnknownEffect(ReadingsResponse)
