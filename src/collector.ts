import type { Cron } from "effect"
import { Effect, Option, Ref, Schedule } from "effect"

import { Bluetooth } from "./bluetooth.ts"
import type { Reading } from "./db/readings.ts"
import { Readings } from "./db/readings.ts"
import { decodeBattery, decodeOutdoorMeter, parseInfo } from "./switchbot.ts"

/** How long the battery check scans actively. */
const batteryScanSeconds = 10

/** Latest known battery percentage, refreshed by `checkBattery`. */
type Battery = Ref.Ref<Option.Option<number>>

const readInfo: (mac: string) => Effect.Effect<string, never, Bluetooth> =
  Effect.fn("readInfo")(function* readInfo(mac: string) {
    const bluetooth = yield* Bluetooth
    return yield* bluetooth.info(mac).pipe(
      Effect.tapError((error) =>
        Effect.logWarning("bluetoothctl failed", error)
      ),
      Effect.orElseSucceed(() => "")
    )
  })

/**
 * Scans actively for a few seconds to read the battery, which the meter only
 * sends in reply to a scan request. Run rarely to spare the meter's battery.
 */
export const checkBattery: (
  mac: string,
  battery: Battery
) => Effect.Effect<void, never, Bluetooth> = Effect.fn("checkBattery")(
  function* checkBattery(mac: string, battery: Battery) {
    const bluetooth = yield* Bluetooth
    yield* bluetooth
      .activeScan(batteryScanSeconds)
      .pipe(
        Effect.catchTag("BluetoothError", (error) =>
          Effect.logWarning("Battery scan failed", error)
        )
      )
    const level = decodeBattery(parseInfo(yield* readInfo(mac)))
    if (Option.isNone(level)) {
      return yield* Effect.logWarning(`Battery of ${mac} not seen`)
    }
    yield* Ref.set(battery, level)
    return yield* Effect.logInfo(`Battery ${level.value}%`)
  }
)

/** Reads the meter once and stores the reading, if the meter was seen. */
export const pollOnce: (
  mac: string,
  battery: Battery
) => Effect.Effect<Option.Option<Reading>, never, Bluetooth | Readings> =
  Effect.fn("pollOnce")(function* pollOnce(mac: string, battery: Battery) {
    const readings = yield* Readings
    const measurement = decodeOutdoorMeter(parseInfo(yield* readInfo(mac)))

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
