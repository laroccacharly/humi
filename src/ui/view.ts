import { Option } from "effect"
import type { Document, Html, HtmlBuilder } from "foldkit/html"

import { uiDays } from "../shared/api.ts"
import { MountChart } from "./chart.ts"
import { Message } from "./message.ts"
import type { Metric } from "./metric.ts"
import { metricKeys, metrics, points } from "./metric.ts"
import type { Model } from "./model.ts"

// VIEW

const CHART_HOST_ID = "readings-chart"

const latest = (model: Model, metric: Metric): Option.Option<number> =>
  Option.map(
    Option.fromNullishOr(points[metric](model.readings).at(-1)),
    ([, value]) => value
  )

const metricView = (
  model: Model,
  metric: Metric,
  h: HtmlBuilder<Message>
): Html =>
  h.button(
    [
      h.Type("button"),
      h.Class("metric"),
      h.DataAttribute("active", String(model.shown.includes(metric))),
      h.OnClick(Message.ClickedMetric({ metric })),
    ],
    [
      h.span([], [metrics[metric].label]),
      h.span(
        [h.Style({ color: `var(--${metric})` })],
        [
          Option.match(latest(model, metric), {
            onNone: () => "–",
            onSome: (value) => `${value}${metrics[metric].unit}`,
          }),
        ]
      ),
    ]
  )

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: "humi",
  body: h.div(
    [h.Class("card")],
    [
      h.div(
        [h.Class("header")],
        [
          h.div(
            [h.Class("title")],
            [
              h.h1([], ["humi"]),
              h.p(
                [],
                [
                  `Readings from the last ${uiDays} days · drag to zoom, double-click to reset`,
                ]
              ),
              Option.match(model.maybeError, {
                onNone: () => h.empty,
                onSome: (error) => h.p([h.Class("error")], [error]),
              }),
            ]
          ),
          ...metricKeys.map((metric) => metricView(model, metric, h)),
        ]
      ),
      h.div([
        h.Class("chart"),
        h.AriaLabel("Readings chart"),
        h.OnMount(MountChart({ hostId: CHART_HOST_ID })),
      ]),
    ]
  ),
})
