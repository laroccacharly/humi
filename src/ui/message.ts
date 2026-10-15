import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"

import { ReadingsResponse } from "../shared/api.ts"
import { Metric } from "./metric.ts"

// MESSAGE

export const Message = defineMessageUnion({
  ClickedMetric: { metric: Metric },
  TickedRefresh: {},
  SucceededFetchReadings: { readings: ReadingsResponse },
  FailedFetchReadings: { error: Schema.String },
  SucceededMountChart: { hostId: Schema.String },
  FailedMountChart: { reason: Schema.String },
  SucceededSyncChart: {},
  FailedSyncChart: { reason: Schema.String },
})
export type Message = typeof Message.Type
