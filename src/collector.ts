import { Duration, Effect, Option, Schedule } from "effect"
import type { ChildProcessSpawner } from "effect/process"

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

/** Runs an active scan and stores the battery, if the meter answered. */
export const recordActiveScan: (
  mac: string,
  seconds: number
) => Effect.Effect<Option.Option<ActiveReading>, never, Bluetooth | Readings> =
  Effect.fn("recordActiveScan")(function* recordActiveScan(
    mac: string,
    seconds: number
  ) {
    const readings = yield* Readings
    const battery = yield* orNotSeen(activeScan(mac, seconds))
    if (Option.isNone(battery)) {
      yield* Effect.logWarning(`Active scan: battery of ${mac} not seen`)
      return Option.none()
    }
    const reading = yield* readings.insertActive(mac, battery.value)
    yield* Effect.logInfo(`Active #${reading.id} battery ${reading.battery}%`)
    return Option.some(reading)
  })

/** Runs a passive scan and stores the measurement, if the meter was seen. */
export const recordPassiveScan: (
  mac: string
) => Effect.Effect<Option.Option<PassiveReading>, never, Bluetooth | Readings> =
  Effect.fn("recordPassiveScan")(function* recordPassiveScan(mac: string) {
    const readings = yield* Readings
    const measurement = yield* orNotSeen(passiveScan(mac))
    if (Option.isNone(measurement)) {
      yield* Effect.logInfo(`Passive scan: ${mac} not seen yet`)
      return Option.none()
    }
    const reading = yield* readings.insertPassive(mac, measurement.value)
    yield* Effect.logInfo(
      `Passive #${reading.id} ${reading.temperature.toFixed(1)}°C ${reading.humidity}% rssi ${reading.rssi ?? "?"}`
    )
    return Option.some(reading)
  })

/** Reads the plug's latest broadcast and stores it, if the plug was heard. */
export const recordPlugScan: (
  mac: string
) => Effect.Effect<Option.Option<PlugReading>, never, Bluetooth | Readings> =
  Effect.fn("recordPlugScan")(function* recordPlugScan(mac: string) {
    const readings = yield* Readings
    const status = yield* orNotSeen(plugScan(mac))
    if (Option.isNone(status)) {
      yield* Effect.logInfo(`Plug scan: ${mac} not seen yet`)
      return Option.none()
    }
    const reading = yield* readings.insertPlug(mac, status.value)
    yield* Effect.logInfo(
      `Plug #${reading.id} ${reading.is_on ? "on" : "off"} ${reading.watts.toFixed(1)} W rssi ${reading.rssi ?? "?"}`
    )
    return Option.some(reading)
  })

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
 */
export const collect: (
  config: HumiConfig
) => Effect.Effect<
  void,
  never,
  Bluetooth | Readings | ChildProcessSpawner.ChildProcessSpawner
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
  const passive =
    config.plugMac === undefined
      ? meter
      : recordPlugScan(config.plugMac).pipe(Effect.andThen(meter))
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
