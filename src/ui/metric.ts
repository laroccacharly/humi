import { Schema } from "effect"

import type { ReadingsResponse } from "../shared/api.ts"

export const Metric = Schema.Literals([
  "temperature",
  "humidity",
  "watts",
  "battery",
])
export type Metric = typeof Metric.Type

export const metricKeys = Metric.literals

export const metrics: Record<
  Metric,
  {
    label: string
    unit: string
    axis: "celsius" | "percent" | "watts"
    /** Whether the line steps between readings instead of curving. */
    step: "end" | false
  }
> = {
  temperature: {
    label: "Temperature",
    unit: "°C",
    axis: "celsius",
    step: false,
  },
  humidity: { label: "Humidity", unit: "%", axis: "percent", step: false },
  // The plug switches, so power steps.
  watts: { label: "Power", unit: " W", axis: "watts", step: "end" },
  battery: { label: "Battery", unit: "%", axis: "percent", step: false },
}

type Point = readonly [t: number, value: number]

/** Each metric's `[t, value]` points, oldest first. */
export const points: Record<
  Metric,
  (readings: typeof ReadingsResponse.Type) => ReadonlyArray<Point>
> = {
  temperature: ({ passive }) => passive.map((row) => [row.t, row.temperature]),
  humidity: ({ passive }) => passive.map((row) => [row.t, row.humidity]),
  watts: ({ plug }) => plug.map((row) => [row.t, row.watts]),
  battery: ({ active }) => active.map((row) => [row.t, row.battery]),
}
