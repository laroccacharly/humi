import { Schema } from "effect"

/** How far back `GET /api/readings` looks. */
export const uiDays = 14

/** What `GET /api/readings` returns, oldest first; `t` is epoch millis. */
export const ReadingsResponse = Schema.Struct({
  passive: Schema.Array(
    Schema.Struct({
      t: Schema.Finite,
      temperature: Schema.Finite,
      humidity: Schema.Finite,
    })
  ),
  plug: Schema.Array(Schema.Struct({ t: Schema.Finite, watts: Schema.Finite })),
  active: Schema.Array(
    Schema.Struct({ t: Schema.Finite, battery: Schema.Finite })
  ),
})

/** Decodes a `GET /api/readings` body. */
export const decodeReadings = Schema.decodeUnknownEffect(ReadingsResponse)
