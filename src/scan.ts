import type { Option } from "effect"
import { Effect } from "effect"

import type { BluetoothError } from "./bluetooth.ts"
import { Bluetooth } from "./bluetooth.ts"
import type { Measurement, PlugStatus } from "./switchbot.ts"
import {
  decodeBattery,
  decodeOutdoorMeter,
  decodePlug,
  parseInfo,
} from "./switchbot.ts"

/** The device's latest advertisement, as BlueZ has it cached. */
const latestAdvertisement = (mac: string) =>
  Bluetooth.use((bluetooth) => bluetooth.info(mac)).pipe(Effect.map(parseInfo))

/**
 * Passive scan: the meter's latest broadcast, heard by the passive scan the
 * `Bluetooth` layer keeps running. Never sends the meter anything. Carries
 * temperature and humidity, but not the battery.
 */
export const passiveScan: (
  mac: string
) => Effect.Effect<Option.Option<Measurement>, BluetoothError, Bluetooth> =
  Effect.fn("passiveScan")(function* passiveScan(mac: string) {
    return decodeOutdoorMeter(yield* latestAdvertisement(mac))
  })

/**
 * The plug's latest broadcast, heard by the same passive scan as the meter
 * (it matches every SwitchBot device). Carries its on/off state and power.
 */
export const plugScan: (
  mac: string
) => Effect.Effect<Option.Option<PlugStatus>, BluetoothError, Bluetooth> =
  Effect.fn("plugScan")(function* plugScan(mac: string) {
    return decodePlug(yield* latestAdvertisement(mac))
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
    yield* Bluetooth.use((bluetooth) => bluetooth.activeScan(seconds))
    return decodeBattery(yield* latestAdvertisement(mac))
  })
