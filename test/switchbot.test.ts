import { describe, expect, test } from "bun:test"

import { Option } from "effect"

import {
  decodeBattery,
  decodeOutdoorMeter,
  isOutdoorMeter,
  isSwitchbot,
  parseDevices,
  parseInfo,
} from "../src/switchbot.ts"

// Captured from a real meter with `bluetoothctl info`, its address replaced.
const info = `Device C0:FF:EE:12:34:56 (random)
\tConnected: no
\tUUID: Unknown                   (0000fd3d-0000-1000-8000-00805f9b34fb)
\tManufacturerData.Key: 0x0969 (2409)
\tManufacturerData.Value:
  c0 ff ee 12 34 56 13 02 08 97 22 00              ....4V....".    
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
    expect(measurement.raw).toBe("c0ffee123456130208972200")
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
    const missing = "Device C0:FF:EE:12:34:56 not available\n"
    expect(Option.isNone(decodeOutdoorMeter(parseInfo(missing)))).toBe(true)
  })
})

describe("Device discovery", () => {
  test("parses bluetoothctl devices, including greyed-out ones", () => {
    const devices = parseDevices(
      "Device C0:FF:EE:12:34:56 C0-FF-EE-12-34-56\n\u001B[1;30mDevice 12:34:56:78:9A:BC Headphones\u001B[0m\nnoise\n"
    )
    expect(devices).toEqual([
      { mac: "C0:FF:EE:12:34:56", name: "C0-FF-EE-12-34-56" },
      { mac: "12:34:56:78:9A:BC", name: "Headphones" },
    ])
  })

  test("recognises the outdoor meter by its own address", () => {
    const advertisement = parseInfo(info)
    expect(isSwitchbot(advertisement)).toBe(true)
    expect(isOutdoorMeter("C0:FF:EE:12:34:56", advertisement)).toBe(true)
    expect(isOutdoorMeter("AA:BB:CC:DD:EE:FF", advertisement)).toBe(false)
    expect(isSwitchbot(parseInfo("Device AA:BB:CC:DD:EE:FF\n"))).toBe(false)
  })
})
