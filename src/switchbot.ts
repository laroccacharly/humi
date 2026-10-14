import { Array as Arr, Option, Schema } from "effect"

/** SwitchBot's Bluetooth company identifier, as printed by `bluetoothctl`. */
export const switchbotCompanyId = "0x0969"

/** Service data UUID SwitchBot devices advertise under. */
const serviceUuid = "0000fd3d-0000-1000-8000-00805f9b34fb"

/** The parts of a `bluetoothctl info` dump the meter decoder needs. */
export interface Advertisement {
  /** SwitchBot manufacturer data, without the company id. */
  readonly manufacturer: readonly number[]
  /** SwitchBot service data, without the UUID. */
  readonly service: readonly number[]
  readonly rssi: Option.Option<number>
}

/**
 * Temperature and humidity from a SwitchBot Indoor/Outdoor Thermo-Hygrometer.
 * They are in the regular broadcast, so passive listening is enough.
 */
export class Measurement extends Schema.Class<Measurement>("Measurement")({
  temperature: Schema.Number,
  humidity: Schema.Int,
  rssi: Schema.NullOr(Schema.Int),
  /** Manufacturer data as hex, to tell fresh advertisements from repeats. */
  raw: Schema.String,
}) {}

const hexLine = /^\s+(?<hex>(?:[0-9a-f]{2} )+)/iu

/** Hex bytes printed on the indented lines that follow `header`. */
const bytesAfter = (lines: readonly string[], header: string): number[] => {
  const start = lines.findIndex((line) => line.includes(header))
  if (start === -1) {
    return []
  }
  const bytes: number[] = []
  for (const line of lines.slice(start + 1)) {
    const match = hexLine.exec(line)
    if (match === null) {
      break
    }
    for (const pair of (match.groups?.hex ?? "").trim().split(" ")) {
      bytes.push(Number.parseInt(pair, 16))
    }
  }
  return bytes
}

/** Extracts SwitchBot advertisement data from `bluetoothctl info <mac>`. */
export const parseInfo = (text: string): Advertisement => {
  const lines = text.split("\n")
  const keyIndex = lines.findIndex((line) =>
    line.includes(`ManufacturerData.Key: ${switchbotCompanyId}`)
  )
  const rssi = /RSSI: \S+ \((?<dbm>-?\d+)\)/u.exec(text)?.groups?.dbm
  return {
    manufacturer:
      keyIndex === -1
        ? []
        : bytesAfter(lines.slice(keyIndex), "ManufacturerData.Value:"),
    service: bytesAfter(lines, `ServiceData.${serviceUuid}:`),
    rssi: Option.map(Option.fromNullishOr(rssi), Number),
  }
}

const toHex = (bytes: readonly number[]): string =>
  bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("")

/** A device listed by `bluetoothctl devices`. */
export interface Device {
  readonly mac: string
  readonly name: string
}

// bluetoothctl colours devices it has not heard from lately.
// oxlint-disable-next-line no-control-regex
const ansi = /\u001B\[[0-9;]*m/gu
const deviceLine =
  /^Device (?<mac>(?:[0-9A-F]{2}:){5}[0-9A-F]{2}) (?<name>.*)$/u

/** Parses `bluetoothctl devices`. */
export const parseDevices = (text: string): Device[] =>
  text
    .replaceAll(ansi, "")
    .split("\n")
    .flatMap((line) => {
      const groups = deviceLine.exec(line.trim())?.groups
      return groups?.mac === undefined
        ? []
        : [{ mac: groups.mac, name: groups.name ?? "" }]
    })

/** Whether the advertisement carries SwitchBot manufacturer data. */
export const isSwitchbot = (advertisement: Advertisement): boolean =>
  advertisement.manufacturer.length > 0

/**
 * The outdoor meter starts its manufacturer data with its own address, which
 * tells it apart from other SwitchBot devices (their layout differs).
 */
export const isOutdoorMeter = (
  mac: string,
  advertisement: Advertisement
): boolean =>
  toHex(advertisement.manufacturer.slice(0, 6)) ===
  mac.replaceAll(":", "").toLowerCase()

/**
 * Decodes a W3400010 advertisement.
 *
 * Unlike other SwitchBot meters, this model puts temperature and humidity in
 * the manufacturer data (after its MAC address) and only the battery in the
 * service data, which arrives in the scan response. Layout from
 * OpenWonderLabs/SwitchBotAPI-BLE#26: the top bit of each byte is a flag
 * (temperature sign, °F display, ...) and the low bits carry the value.
 */
export const decodeOutdoorMeter = (
  advertisement: Advertisement
): Option.Option<Measurement> =>
  Option.all({
    fraction: Arr.get(advertisement.manufacturer, 8),
    integer: Arr.get(advertisement.manufacturer, 9),
    humidity: Arr.get(advertisement.manufacturer, 10),
  }).pipe(
    Option.map(
      ({ fraction, integer, humidity }) =>
        new Measurement({
          temperature:
            (integer >= 0x80 ? 1 : -1) *
            ((integer % 0x80) + (fraction % 0x10) / 10),
          humidity: humidity % 0x80,
          rssi: Option.getOrNull(advertisement.rssi),
          raw: toHex(advertisement.manufacturer),
        })
    )
  )

/** Battery percentage from the scan response's service data. */
export const decodeBattery = (
  advertisement: Advertisement
): Option.Option<number> =>
  Option.map(Arr.get(advertisement.service, 2), (battery) => battery % 0x80)

/** On/off state and power from a SwitchBot Plug Mini broadcast. */
export class PlugStatus extends Schema.Class<PlugStatus>("PlugStatus")({
  on: Schema.Boolean,
  /** Power drawn through the plug, in watts. */
  watts: Schema.Number,
  rssi: Schema.NullOr(Schema.Int),
  /** Manufacturer data as hex, to tell fresh advertisements from repeats. */
  raw: Schema.String,
}) {}

/**
 * Decodes a Plug Mini advertisement. Its manufacturer data follows its
 * address with a sequence number, then `0x80` when on, and the power in
 * tenths of a watt at bytes 10 and 11 (layout from pySwitchbot).
 */
export const decodePlug = (
  advertisement: Advertisement
): Option.Option<PlugStatus> =>
  Option.all({
    state: Arr.get(advertisement.manufacturer, 7),
    high: Arr.get(advertisement.manufacturer, 10),
    low: Arr.get(advertisement.manufacturer, 11),
  }).pipe(
    Option.map(
      ({ state, high, low }) =>
        new PlugStatus({
          on: state === 0x80,
          watts: ((high % 0x80) * 0x1_00 + low) / 10,
          rssi: Option.getOrNull(advertisement.rssi),
          raw: toHex(advertisement.manufacturer),
        })
    )
  )
