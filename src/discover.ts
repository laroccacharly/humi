import { Effect, Option } from "effect"

import type { BluetoothError } from "./bluetooth.ts"
import { Bluetooth } from "./bluetooth.ts"
import type { Device, Measurement } from "./switchbot.ts"
import {
  decodeOutdoorMeter,
  isOutdoorMeter,
  isSwitchbot,
  parseDevices,
  parseInfo,
} from "./switchbot.ts"

/** A SwitchBot device heard during the scan. */
export interface Found extends Device {
  readonly rssi: Option.Option<number>
  /** Present when the device is an Indoor/Outdoor meter. */
  readonly measurement: Option.Option<Measurement>
}

/** Scans actively for `seconds`, then lists the SwitchBot devices BlueZ saw. */
export const findSwitchbots: (
  seconds: number
) => Effect.Effect<readonly Found[], BluetoothError, Bluetooth> = Effect.fn(
  "findSwitchbots"
)(function* findSwitchbots(seconds: number) {
  const bluetooth = yield* Bluetooth
  yield* bluetooth.activeScan(seconds)
  const devices = parseDevices(yield* bluetooth.devices)
  const found = yield* Effect.forEach(
    devices,
    (device) =>
      Effect.map(bluetooth.info(device.mac), (text) => {
        const advertisement = parseInfo(text)
        return isSwitchbot(advertisement)
          ? Option.some<Found>({
              ...device,
              rssi: advertisement.rssi,
              measurement: isOutdoorMeter(device.mac, advertisement)
                ? decodeOutdoorMeter(advertisement)
                : Option.none(),
            })
          : Option.none<Found>()
      }),
    { concurrency: 8 }
  )
  return found.flatMap(Option.toArray)
})
