import { Effect, Fiber, Option, Schedule } from "effect"
import { useEffect, useMemo, useState } from "react"
import { createRoot } from "react-dom/client"
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import type { ReadingsResponse } from "./api.ts"
import { decodeReadings } from "./api.ts"

const metricKeys = ["temperature", "humidity", "watts", "battery"] as const

type Metric = (typeof metricKeys)[number]

const metrics: Record<
  Metric,
  { label: string; unit: string; axis: "celsius" | "percent" | "watts" }
> = {
  temperature: { label: "Temperature", unit: "°C", axis: "celsius" },
  humidity: { label: "Humidity", unit: "%", axis: "percent" },
  watts: { label: "Power", unit: " W", axis: "watts" },
  battery: { label: "Battery", unit: "%", axis: "percent" },
}

/** One chart row per reading; the metrics a reading lacks stay unset. */
type Row = { readonly t: number } & Partial<Record<Metric, number>>

const fetchReadings = Effect.tryPromise(async () => {
  const response = await fetch("/api/readings")
  const body: unknown = await response.json()
  return body
}).pipe(Effect.flatMap(decodeReadings))

const formatDate = (t: number) =>
  new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" })

const formatTime = (t: number) =>
  new Date(t).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  })

const twoDaysMs = 2 * 24 * 3_600_000

const formatDateTime = (t: number) =>
  new Date(t).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })

const useReadings = () => {
  const [data, setData] = useState<typeof ReadingsResponse.Type>({
    passive: [],
    plug: [],
    active: [],
  })
  useEffect(() => {
    const fiber = Effect.runFork(
      fetchReadings.pipe(
        Effect.tap((readings) =>
          Effect.sync(() => {
            setData(readings)
          })
        ),
        Effect.ignore({ log: true }),
        Effect.repeat(Schedule.spaced("1 minute"))
      )
    )
    return () => {
      Effect.runFork(Fiber.interrupt(fiber))
    }
  }, [])
  return data
}

const App = () => {
  const data = useReadings()
  const [shown, setShown] = useState<ReadonlySet<Metric>>(
    () => new Set(metricKeys)
  )

  const rows = useMemo(
    (): Row[] =>
      [...data.passive, ...data.plug, ...data.active].toSorted(
        (a, b) => a.t - b.t
      ),
    [data]
  )
  const spanMs = (rows.at(-1)?.t ?? 0) - (rows.at(0)?.t ?? 0)
  const lastPassive = Option.fromNullishOr(data.passive.at(-1))
  const latest: Record<Metric, Option.Option<number>> = {
    temperature: lastPassive.pipe(Option.map((row) => row.temperature)),
    humidity: lastPassive.pipe(Option.map((row) => row.humidity)),
    watts: Option.fromNullishOr(data.plug.at(-1)).pipe(
      Option.map((row) => row.watts)
    ),
    battery: Option.fromNullishOr(data.active.at(-1)).pipe(
      Option.map((row) => row.battery)
    ),
  }

  const toggle = (metric: Metric) => {
    setShown((current) => {
      const next = new Set(current)
      if (!next.delete(metric)) {
        next.add(metric)
      }
      return next
    })
  }

  return (
    <div className="card">
      <div className="header">
        <div className="title">
          <h1>humi</h1>
          <p>Readings from the last 14 days</p>
        </div>
        {metricKeys.map((metric) => (
          <button
            key={metric}
            type="button"
            className="metric"
            data-active={shown.has(metric)}
            onClick={() => {
              toggle(metric)
            }}
          >
            <span>{metrics[metric].label}</span>
            <span style={{ color: `var(--${metric})` }}>
              {Option.match(latest[metric], {
                onNone: () => "–",
                onSome: (value) => `${value}${metrics[metric].unit}`,
              })}
            </span>
          </button>
        ))}
      </div>
      <div className="chart">
        <ResponsiveContainer>
          <LineChart data={rows} margin={{ left: 12, right: 12 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={spanMs < twoDaysMs ? formatTime : formatDate}
              tickLine={false}
              axisLine={false}
              minTickGap={32}
            />
            <YAxis
              yAxisId="percent"
              domain={[0, 100]}
              unit="%"
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              yAxisId="celsius"
              orientation="right"
              domain={["auto", "auto"]}
              unit="°C"
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              yAxisId="watts"
              orientation="right"
              domain={[0, "auto"]}
              unit=" W"
              tickLine={false}
              axisLine={false}
              hide={!shown.has("watts")}
            />
            <Tooltip
              labelFormatter={(t) => formatDateTime(Number(t))}
              contentStyle={{
                background: "var(--background)",
                borderColor: "var(--border)",
              }}
            />
            {metricKeys
              .filter((metric) => shown.has(metric))
              .map((metric) => (
                <Line
                  key={metric}
                  yAxisId={metrics[metric].axis}
                  dataKey={metric}
                  name={metrics[metric].label}
                  unit={metrics[metric].unit}
                  // The plug switches, so power steps instead of curving.
                  type={metric === "watts" ? "stepAfter" : "monotone"}
                  stroke={`var(--${metric})`}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

const root = document.querySelector("#root")
if (root) {
  createRoot(root).render(<App />)
}
