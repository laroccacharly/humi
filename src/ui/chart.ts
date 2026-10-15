import type { EChartsOption } from "echarts"
import { LineChart } from "echarts/charts"
import {
  DataZoomComponent,
  GridComponent,
  ToolboxComponent,
  TooltipComponent,
} from "echarts/components"
import * as echarts from "echarts/core"
import { CanvasRenderer } from "echarts/renderers"
import { Effect, Option, Queue, Schema, Stream } from "effect"
import { Mount } from "foldkit"

import type { ReadingsResponse } from "../shared/api.ts"
import { Message } from "./message.ts"
import type { Metric } from "./metric.ts"
import { metrics, points } from "./metric.ts"

echarts.use([
  LineChart,
  DataZoomComponent,
  GridComponent,
  ToolboxComponent,
  TooltipComponent,
  CanvasRenderer,
])

type Chart = ReturnType<typeof echarts.init>

/** The live charts, by host id, for `SyncChart` to draw into. */
const chartsByHostId = new Map<string, Chart>()

export const getChart = (hostId: string): Option.Option<Chart> =>
  Option.fromNullishOr(chartsByHostId.get(hostId))

/** A colour from the stylesheet, so the chart follows the light/dark theme. */
const cssVar = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim()

const axisStyle = () => ({
  axisLabel: { color: cssVar("--muted-foreground") },
  splitLine: { lineStyle: { color: cssVar("--border") } },
})

/** The whole chart for `readings`, drawing only the `shown` metrics. */
export const chartOption = (
  readings: typeof ReadingsResponse.Type,
  shown: ReadonlyArray<Metric>
): EChartsOption => ({
  animation: false,
  grid: { left: 48, right: 96, top: 48, bottom: 72 },
  tooltip: {
    trigger: "axis",
    backgroundColor: cssVar("--background"),
    borderColor: cssVar("--border"),
    textStyle: { color: cssVar("--foreground") },
  },
  // Its zoom button stays on (see `selectZoom`), so dragging always zooms.
  toolbox: {
    top: 0,
    right: 16,
    feature: { dataZoom: { yAxisIndex: "none" }, restore: {} },
  },
  dataZoom: [{ id: "slider", type: "slider", bottom: 16, height: 24 }],
  xAxis: {
    type: "time",
    ...axisStyle(),
    splitLine: { show: false },
  },
  yAxis: [
    {
      id: "percent",
      type: "value",
      min: 0,
      max: 100,
      ...axisStyle(),
      axisLabel: { ...axisStyle().axisLabel, formatter: "{value}%" },
    },
    {
      id: "celsius",
      type: "value",
      position: "right",
      scale: true,
      ...axisStyle(),
      axisLabel: { ...axisStyle().axisLabel, formatter: "{value}°C" },
      splitLine: { show: false },
    },
    {
      id: "watts",
      type: "value",
      position: "right",
      offset: 48,
      min: 0,
      show: shown.includes("watts"),
      ...axisStyle(),
      axisLabel: { ...axisStyle().axisLabel, formatter: "{value} W" },
      splitLine: { show: false },
    },
  ],
  series: shown.map((metric) => ({
    id: metric,
    name: metrics[metric].label,
    type: "line",
    yAxisId: metrics[metric].axis,
    data: points[metric](readings).map(([t, value]) => [t, value]),
    // Draws one point per pixel or so, keeping the peaks, however many readings.
    sampling: "lttb",
    // The plug switches, so power steps instead of curving.
    step: metric === "watts" ? "end" : false,
    showSymbol: false,
    connectNulls: true,
    color: cssVar(`--${metric}`),
    lineStyle: { width: 2 },
    tooltip: {
      valueFormatter: (value) => `${String(value)}${metrics[metric].unit}`,
    },
  })),
})

/** Arms the toolbox's zoom, so a drag across the plot selects a range. */
const selectZoom = (chart: Chart) => {
  chart.dispatchAction({
    type: "takeGlobalCursor",
    key: "dataZoomSelect",
    dataZoomSelectActive: true,
  })
}

const resetZoom = (chart: Chart) => {
  chart.dispatchAction({ type: "dataZoom", start: 0, end: 100 })
}

type MountChartMessage =
  | typeof Message.SucceededMountChart.Type
  | typeof Message.FailedMountChart.Type

const mountChart = (element: Element, hostId: string) =>
  Stream.callback<MountChartMessage>((queue) =>
    Effect.gen(function* acquireChart() {
      if (!(element instanceof HTMLElement)) {
        return yield* Effect.fail(new Error("The chart host is not an element"))
      }
      const chart = yield* Effect.acquireRelease(
        Effect.try(() => echarts.init(element, null, { renderer: "canvas" })),
        (live) =>
          Effect.sync(() => {
            chartsByHostId.delete(hostId)
            live.dispose()
          })
      )
      chartsByHostId.set(hostId, chart)
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          const observer = new ResizeObserver(() => {
            chart.resize()
          })
          const onDoubleClick = () => {
            resetZoom(chart)
          }
          // Restoring and redrawing disarm the zoom button, so re-arm it.
          const onFinished = () => {
            selectZoom(chart)
          }
          observer.observe(element)
          chart.getZr().on("dblclick", onDoubleClick)
          chart.on("restore", onFinished)
          chart.on("finished", onFinished)
          return { observer, onDoubleClick, onFinished }
        }),
        ({ observer, onDoubleClick, onFinished }) =>
          Effect.sync(() => {
            chart.off("finished", onFinished)
            chart.off("restore", onFinished)
            chart.getZr().off("dblclick", onDoubleClick)
            observer.disconnect()
          })
      )
      Queue.offerUnsafe(queue, Message.SucceededMountChart({ hostId }))
      return yield* Effect.never
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          Queue.offerUnsafe(
            queue,
            Message.FailedMountChart({ reason: String(error) })
          )
        })
      )
    )
  )

export const MountChart = Mount.defineStream("MountChart", {
  args: { hostId: Schema.String },
  messages: [Message.SucceededMountChart, Message.FailedMountChart],
  execute: ({ element, hostId }) => mountChart(element, hostId),
})
