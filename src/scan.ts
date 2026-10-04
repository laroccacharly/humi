import type { Option } from "effect"
import { Effect } from "effect"

import type { BluetoothError } from "./bluetooth.ts"
import { Bluetooth } from "./bluetooth.ts"
import type { Measurement } from "./switchbot.ts"
import { decodeBattery, decodeOutdoorMeter, parseInfo } from "./switchbot.ts"

/**
 * Passive scan: the meter's latest broadcast, heard by the passive scan the
 * `Bluetooth` layer keeps running. Never sends the meter anything. Carries
 * temperature and humidity, but not the battery.
 */
export const passiveScan: (
  mac: string
) => Effect.Effect<Option.Option<Measurement>, BluetoothError, Bluetooth> =
  Effect.fn("passiveScan")(function* passiveScan(mac: string) {
    const bluetooth = yield* Bluetooth
    return decodeOutdoorMeter(parseInfo(yield* bluetooth.info(mac)))
  })

/**
 * Active scan: sends scan requests for `seconds`, and the meter's scan
 * response carries the battery. Costs the meter battery, so run it rarely.
 */
export const activeScan: (
  mac: string,
  seconds: number
) => Effect.Effect<Option.Option<number>, BluetoothError, Bluetooth> =
  Effect.fn("activeScan")(function* activeScan(mac: string, seconds: number) {
    const bluetooth = yield* Bluetooth
    yield* bluetooth.activeScan(seconds)
    return decodeBattery(parseInfo(yield* bluetooth.info(mac)))
  })
