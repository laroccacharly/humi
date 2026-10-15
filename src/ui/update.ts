import { Option } from "effect"
import type { Command, Update } from "foldkit"
import { modifyFields } from "foldkit/struct"

import { FetchReadings, SyncChart } from "./command.ts"
import { Message } from "./message.ts"
import { metricKeys } from "./metric.ts"
import type { Model } from "./model.ts"

// UPDATE

type UpdateReturn = Update.Return<Model, Message>

const syncChart = (model: Model): ReadonlyArray<Command.Command<Message>> =>
  Option.match(model.maybeChartHostId, {
    onNone: () => [],
    onSome: (hostId) => [
      SyncChart({ hostId, readings: model.readings, shown: model.shown }),
    ],
  })

/** Applies `change` and redraws the chart from the result. */
const redraw = (model: Model, change: (model: Model) => Model) => {
  const next = change(model)
  return { model: next, commands: syncChart(next) }
}

const failed = (model: Model, error: string): UpdateReturn => ({
  model: modifyFields(model, { maybeError: () => Option.some(error) }),
})

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    ClickedMetric: ({ metric }) =>
      redraw(
        model,
        modifyFields({
          shown: (shown) =>
            metricKeys.filter((key) =>
              key === metric ? !shown.includes(key) : shown.includes(key)
            ),
        })
      ),
    TickedRefresh: () => ({ model, commands: [FetchReadings()] }),
    SucceededFetchReadings: ({ readings }) =>
      redraw(
        model,
        modifyFields({
          readings: () => readings,
          maybeError: () => Option.none(),
        })
      ),
    FailedFetchReadings: ({ error }) => failed(model, error),
    SucceededMountChart: ({ hostId }) =>
      redraw(
        model,
        modifyFields({ maybeChartHostId: () => Option.some(hostId) })
      ),
    FailedMountChart: ({ reason }) => failed(model, reason),
    SucceededSyncChart: () => ({ model }),
    FailedSyncChart: ({ reason }) => failed(model, reason),
  })
