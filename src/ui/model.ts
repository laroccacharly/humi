import { Schema } from "effect"

import { ReadingsResponse } from "../shared/api.ts"
import { Metric } from "./metric.ts"

// MODEL

export const Model = Schema.Struct({
  readings: ReadingsResponse,
  shown: Schema.Array(Metric),
  maybeChartHostId: Schema.Option(Schema.String),
  maybeError: Schema.Option(Schema.String),
})
export type Model = typeof Model.Type
