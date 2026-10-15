import { Effect, Option, Schema } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { Command, Http } from "foldkit"

import { ReadingsResponse } from "../shared/api.ts"
import { chartOption, getChart } from "./chart.ts"
import { Message } from "./message.ts"
import { Metric } from "./metric.ts"

// COMMAND

export const FetchReadings = Command.define("FetchReadings", {
  messages: [Message.SucceededFetchReadings, Message.FailedFetchReadings],
  execute: Effect.gen(function* fetchReadings() {
    const client = yield* HttpClient.HttpClient
    const response = yield* client
      .pipe(HttpClient.filterStatusOk)
      .get("/api/readings")
    return yield* HttpClientResponse.schemaBodyJson(ReadingsResponse)(response)
  }).pipe(
    Effect.map((readings) => Message.SucceededFetchReadings({ readings })),
    Effect.orElseSucceed(() =>
      Message.FailedFetchReadings({ error: "Could not load the readings" })
    ),
    Effect.provide(Http.layer)
  ),
})

export const SyncChart = Command.define("SyncChart", {
  args: {
    hostId: Schema.String,
    readings: ReadingsResponse,
    shown: Schema.Array(Metric),
  },
  messages: [Message.SucceededSyncChart, Message.FailedSyncChart],
  execute: ({ hostId, readings, shown }) =>
    Option.match(getChart(hostId), {
      onNone: () =>
        Effect.succeed(
          Message.FailedSyncChart({ reason: `No chart mounted as ${hostId}` })
        ),
      onSome: (chart) =>
        Effect.try(() => {
          // Replacing only the series keeps the zoom across refreshes.
          chart.setOption(chartOption(readings, shown), {
            replaceMerge: ["series"],
          })
        }).pipe(
          Effect.as(Message.SucceededSyncChart()),
          Effect.orElseSucceed(() =>
            Message.FailedSyncChart({ reason: "Could not draw the chart" })
          )
        ),
    }),
})
