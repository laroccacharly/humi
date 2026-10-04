import type { Cron } from "effect"
import { Effect, Option, Ref, Schedule } from "effect"

import type { Bluetooth, BluetoothError } from "./bluetooth.ts"
import type { Reading } from "./db/readings.ts"
import { Readings } from "./db/readings.ts"
import { activeScan, passiveScan } from "./scan.ts"

/** How long the battery check scans actively. */
const batteryScanSeconds = 10

/** Latest known battery percentage, refreshed by `checkBattery`. */
type Battery = Ref.Ref<Option.Option<number>>

/** Logs a failed scan and treats it as the meter not being seen. */
const orNotSeen = <A>(
  scan: Effect.Effect<Option.Option<A>, BluetoothError, Bluetooth>
): Effect.Effect<Option.Option<A>, never, Bluetooth> =>
  scan.pipe(
    Effect.tapError((failure) => Effect.logWarning("Scan failed", failure)),
    Effect.orElseSucceed(Option.none<A>)
  )

/** Reads the battery with an active scan. Run rarely to spare the meter. */
export const checkBattery: (
  mac: string,
  battery: Battery
) => Effect.Effect<void, never, Bluetooth> = Effect.fn("checkBattery")(
  function* checkBattery(mac: string, battery: Battery) {
    const level = yield* orNotSeen(activeScan(mac, batteryScanSeconds))
    if (Option.isNone(level)) {
      return yield* Effect.logWarning(`Battery of ${mac} not seen`)
    }
    yield* Ref.set(battery, level)
    return yield* Effect.logInfo(`Battery ${level.value}%`)
  }
)

/** Reads the meter with the passive scan and stores it, if it was seen. */
export const pollOnce: (
  mac: string,
  battery: Battery
) => Effect.Effect<Option.Option<Reading>, never, Bluetooth | Readings> =
  Effect.fn("pollOnce")(function* pollOnce(mac: string, battery: Battery) {
    const readings = yield* Readings
    const measurement = yield* orNotSeen(passiveScan(mac))

    if (Option.isNone(measurement)) {
      yield* Effect.logInfo(`${mac} not seen yet`)
      return Option.none()
    }

    const level = Option.getOrNull(yield* Ref.get(battery))
    const reading = yield* readings.insert(mac, measurement.value, level)
    yield* Effect.logInfo(
      `#${reading.id} ${reading.temperature.toFixed(1)}°C ${reading.humidity}% battery ${reading.battery ?? "?"}% rssi ${reading.rssi ?? "?"}`
    )
    return Option.some(reading)
  })

/**
 * Checks the battery, then polls the meter on every tick of `expression`
 * (passively) and re-checks the battery on every tick of `batteryExpression`
 * (actively), forever.
 */
export const collect: (
  mac: string,
  expression: string,
  batteryExpression: string
) => Effect.Effect<void, Cron.CronParseError, Bluetooth | Readings> = Effect.fn(
  "collect"
)(function* collect(
  mac: string,
  expression: string,
  batteryExpression: string
) {
  const battery: Battery = yield* Ref.make(Option.none<number>())
  yield* Effect.logInfo(
    `Polling ${mac} on "${expression}", battery on "${batteryExpression}"`
  )
  yield* checkBattery(mac, battery)
  yield* Effect.all(
    [
      checkBattery(mac, battery).pipe(
        Effect.schedule(Schedule.cron(batteryExpression))
      ),
      pollOnce(mac, battery).pipe(Effect.repeat(Schedule.cron(expression))),
    ],
    { concurrency: "unbounded", discard: true }
  )
})
