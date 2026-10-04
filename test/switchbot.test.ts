import { describe, expect, test } from "bun:test"

import { Option } from "effect"

import {
  decodeBattery,
  decodeOutdoorMeter,
  parseInfo,
} from "../src/switchbot.ts"

// Captured from the real meter with `bluetoothctl info EC:0F:01:46:10:4A`.
const info = `Device EC:0F:01:46:10:4A (random)
\tConnected: no
\tUUID: Unknown                   (0000fd3d-0000-1000-8000-00805f9b34fb)
\tManufacturerData.Key: 0x0969 (2409)
\tManufacturerData.Value:
  ec 0f 01 46 10 4a 13 02 08 97 22 00              ...F.J....".    
\tServiceData.0000fd3d-0000-1000-8000-00805f9b34fb:
  77 00 e4                                         w..             
\tRSSI: 0xffffffca (-54)
\tAdvertisingFlags:
  06                                               .               
`

describe("SwitchBot outdoor meter", () => {
  test("decodes a captured advertisement", () => {
    const advertisement = parseInfo(info)
    const measurement = Option.getOrThrow(decodeOutdoorMeter(advertisement))
    expect(measurement.temperature).toBeCloseTo(23.8)
    expect(measurement.humidity).toBe(34)
    expect(measurement.rssi).toBe(-54)
    expect(decodeBattery(advertisement)).toEqual(Option.some(100))
    expect(measurement.raw).toBe("ec0f0146104a130208972200")
  })

  test("decodes below-zero temperatures", () => {
    const manufacturer = [0, 0, 0, 0, 0, 0, 0, 0, 0x05, 0x03, 0x50]
    const measurement = decodeOutdoorMeter({
      manufacturer,
      service: [],
      rssi: Option.none(),
    }).pipe(Option.getOrThrow)
    expect(measurement.temperature).toBeCloseTo(-3.5)
    expect(measurement.humidity).toBe(80)
    expect(measurement.rssi).toBeNull()
  })

  test("has no battery when listening passively", () => {
    const passive = info.replace(/\tServiceData[^\t]*/u, "")
    expect(Option.isSome(decodeOutdoorMeter(parseInfo(passive)))).toBe(true)
    expect(Option.isNone(decodeBattery(parseInfo(passive)))).toBe(true)
  })

  test("is none when the meter has not been seen", () => {
    const missing = "Device EC:0F:01:46:10:4A not available\n"
    expect(Option.isNone(decodeOutdoorMeter(parseInfo(missing)))).toBe(true)
  })
})
