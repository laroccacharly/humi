import { Duration, Effect, Option, Schedule } from "effect"

import type { Bluetooth, BluetoothError } from "./bluetooth.ts"
import type { HumiConfig } from "./config.ts"
import { activeScanSeconds } from "./config.ts"
import type { ActiveReading, PassiveReading } from "./db/readings.ts"
import { Readings } from "./db/readings.ts"
import { activeScan, passiveScan } from "./scan.ts"

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
 * `activeScanMinutes`, forever, both starting right away.
 */
export const collect: (
  config: HumiConfig
) => Effect.Effect<void, never, Bluetooth | Readings> = Effect.fn("collect")(
  function* collect(config: HumiConfig) {
    yield* Effect.logInfo(
      `Reading ${config.mac}: passive scan every ${config.passiveScanMinutes} min, active scan every ${config.activeScanMinutes} min for ${activeScanSeconds(config)}s`
    )
    return yield* Effect.all(
      [
        everyMinutes(config.passiveScanMinutes, recordPassiveScan(config.mac)),
        everyMinutes(
          config.activeScanMinutes,
          recordActiveScan(config.mac, activeScanSeconds(config))
        ),
      ],
      { concurrency: "unbounded", discard: true }
    )
  }
)
