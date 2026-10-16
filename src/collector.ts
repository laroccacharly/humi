import { Clock, Duration, Effect, Option, Ref, Schedule } from "effect"
import type { Push } from "effect-lib/push"
import type { ChildProcessSpawner } from "effect/process"

import type { PlugWatch } from "./alert.ts"
import { alert, watchPlug } from "./alert.ts"
import type { Bluetooth, BluetoothError } from "./bluetooth.ts"
import type { HumiConfig } from "./config.ts"
import { activeScanSeconds } from "./config.ts"
import type {
  ActiveReading,
  PassiveReading,
  PlugReading,
} from "./db/readings.ts"
import { Readings } from "./db/readings.ts"
import { plugSchedule, plugScheduler } from "./plug-scheduler.ts"
import { activeScan, passiveScan, plugScan } from "./scan.ts"

/** Logs a failed scan and treats it as the meter not being seen. */
const orNotSeen = <A>(
  scan: Effect.Effect<Option.Option<A>, BluetoothError, Bluetooth>
): Effect.Effect<Option.Option<A>, never, Bluetooth> =>
  scan.pipe(
    Effect.tapError((failure) => Effect.logWarning("Scan failed", failure)),
    Effect.orElseSucceed(Option.none<A>)
  )

/**
 * Runs `scan` and stores what it found, logging the stored row, or runs
 * `notSeen` when it found nothing.
 */
const record = <A, Row>(options: {
  readonly scan: Effect.Effect<Option.Option<A>, BluetoothError, Bluetooth>
  readonly notSeen: Effect.Effect<void>
  readonly store: (found: A) => Effect.Effect<Row, never, Readings>
  readonly describe: (row: Row) => string
}): Effect.Effect<Option.Option<Row>, never, Bluetooth | Readings> =>
  orNotSeen(options.scan).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => options.notSeen.pipe(Effect.as(Option.none<Row>())),
        onSome: (found) =>
          options.store(found).pipe(
            Effect.tap((row) => Effect.logInfo(options.describe(row))),
            Effect.map(Option.some)
          ),
      })
    )
  )

/** Runs an active scan and stores the battery, if the meter answered. */
export const recordActiveScan = (
  mac: string,
  seconds: number
): Effect.Effect<Option.Option<ActiveReading>, never, Bluetooth | Readings> =>
  record({
    scan: activeScan(mac, seconds),
    notSeen: Effect.logWarning(`Active scan: battery of ${mac} not seen`),
    store: (battery) =>
      Readings.use((readings) => readings.insertActive(mac, battery)),
    describe: (reading) => `Active #${reading.id} battery ${reading.battery}%`,
  }).pipe(Effect.withSpan("recordActiveScan"))

/** Runs a passive scan and stores the measurement, if the meter was seen. */
export const recordPassiveScan = (
  mac: string
): Effect.Effect<Option.Option<PassiveReading>, never, Bluetooth | Readings> =>
  record({
    scan: passiveScan(mac),
    notSeen: Effect.logInfo(`Passive scan: ${mac} not seen yet`),
    store: (measurement) =>
      Readings.use((readings) => readings.insertPassive(mac, measurement)),
    describe: (reading) =>
      `Passive #${reading.id} ${reading.temperature.toFixed(1)}°C ${reading.humidity}% rssi ${reading.rssi ?? "?"}`,
  }).pipe(Effect.withSpan("recordPassiveScan"))

/** Reads the plug's latest broadcast and stores it, if the plug was heard. */
export const recordPlugScan = (
  mac: string
): Effect.Effect<Option.Option<PlugReading>, never, Bluetooth | Readings> =>
  record({
    scan: plugScan(mac),
    notSeen: Effect.logInfo(`Plug scan: ${mac} not seen yet`),
    store: (status) =>
      Readings.use((readings) => readings.insertPlug(mac, status)),
    describe: (reading) =>
      `Plug #${reading.id} ${reading.is_on ? "on" : "off"} ${reading.watts.toFixed(1)} W rssi ${reading.rssi ?? "?"}`,
  }).pipe(Effect.withSpan("recordPlugScan"))

/** Runs `effect` now, then again `minutes` after each run finishes. */
const everyMinutes = <A, E, R>(
  minutes: number,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<void, E, R> =>
  effect.pipe(
    Effect.repeat(Schedule.spaced(Duration.minutes(minutes))),
    Effect.asVoid
  )

/**
 * Runs the passive scan every `passiveScanMinutes` and the active scan every
 * `activeScanMinutes`, forever, both starting right away. With a plug in the
 * config, each passive scan also records the plug's broadcast, and when the
 * plug schedule is configured, each meter reading also switches the plug.
 * A plug that goes silent, and comes back, raises an alert.
 */
export const collect: (
  config: HumiConfig
) => Effect.Effect<
  void,
  never,
  Bluetooth | Readings | ChildProcessSpawner.ChildProcessSpawner | Push
> = Effect.fn("collect")(function* collect(config: HumiConfig) {
  yield* Effect.logInfo(
    `Reading ${config.mac}: passive scan every ${config.passiveScanMinutes} min, active scan every ${config.activeScanMinutes} min for ${activeScanSeconds(config)}s`
  )
  const schedule = plugSchedule(config)
  if (Option.isSome(schedule)) {
    yield* Effect.logInfo(
      `Plug ${schedule.value.plugMac}: on at ${schedule.value.onHumidity}%, off at ${schedule.value.offHumidity}%`
    )
  }
  const updatePlug = Option.isSome(schedule)
    ? Option.some(yield* plugScheduler(schedule.value))
    : Option.none()
  const meter = recordPassiveScan(config.mac).pipe(
    Effect.tap((reading) =>
      Option.isSome(reading) && Option.isSome(updatePlug)
        ? updatePlug.value(reading.value.humidity)
        : Effect.void
    )
  )
  const plugWatch = yield* Ref.make<PlugWatch>({
    lastHeard: yield* Clock.currentTimeMillis,
    alerted: false,
  })
  const watchedPlugScan: (
    mac: string
  ) => Effect.Effect<
    void,
    never,
    Bluetooth | Readings | ChildProcessSpawner.ChildProcessSpawner | Push
  > = Effect.fn("watchedPlugScan")(function* watchedPlugScan(mac: string) {
    const heard = Option.isSome(yield* recordPlugScan(mac))
    const now = yield* Clock.currentTimeMillis
    const message = yield* Ref.modify(plugWatch, (watch) => {
      const [next, alertMessage] = watchPlug(watch, heard, now)
      return [alertMessage, next]
    })
    if (Option.isSome(message)) {
      yield* alert(message.value)
    }
  })
  const passive =
    config.plugMac === undefined
      ? meter
      : watchedPlugScan(config.plugMac).pipe(Effect.andThen(meter))
  return yield* Effect.all(
    [
      everyMinutes(config.passiveScanMinutes, passive),
      everyMinutes(
        config.activeScanMinutes,
        recordActiveScan(config.mac, activeScanSeconds(config))
      ),
    ],
    { concurrency: "unbounded", discard: true }
  )
})
