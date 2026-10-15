import { Duration, Option, Stream } from "effect"
import { Subscription } from "foldkit"
import type { Runtime } from "foldkit"

import { FetchReadings } from "./command.ts"
import { Message } from "./message.ts"
import { metricKeys } from "./metric.ts"
import type { Model } from "./model.ts"

// INIT

export const init: Runtime.ApplicationInit<Model, Message> = () => ({
  model: {
    readings: { passive: [], plug: [], active: [] },
    shown: metricKeys,
    maybeChartHostId: Option.none(),
    maybeError: Option.none(),
  },
  commands: [FetchReadings()],
})

// SUBSCRIPTION

/** Refetches every minute; `init` already fetched the first time. */
export const subscriptions = Subscription.make<Model, Message>()(() => ({
  refresh: Subscription.persistentEntry(
    Stream.tick(Duration.minutes(1)).pipe(
      Stream.drop(1),
      Stream.map(() => Message.TickedRefresh())
    )
  ),
}))
