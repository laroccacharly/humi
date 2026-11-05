import { expect, test } from "bun:test"

import { Schema } from "effect"

import { activeScanSeconds, HumiConfig } from "../src/config.ts"

const decode = Schema.decodeUnknownExit(HumiConfig)
const mac = "C0:FF:EE:12:34:56"
const intervals = { passiveScanMinutes: 1, activeScanMinutes: 1440 }

test("accepts an address and a frequency", () => {
  expect(decode({ mac, ...intervals })._tag).toBe("Success")
})

test("rejects a malformed address and intervals under a minute", () => {
  for (const input of [
    { mac: "C0:FF:EE:12:34", ...intervals },
    { mac, ...intervals, passiveScanMinutes: 0 },
    { mac, ...intervals, activeScanMinutes: 1.5 },
  ]) {
    expect(decode(input)._tag).toBe("Failure")
  }
})

test("addresses are saved in uppercase", () => {
  expect(
    Schema.decodeSync(HumiConfig)({ mac: "c0:ff:ee:12:34:56", ...intervals })
      .mac
  ).toBe(mac)
})

test("without intervals, passive scans run every minute and active ones daily", () => {
  const config = Schema.decodeSync(HumiConfig)({ mac })
  expect([config.passiveScanMinutes, config.activeScanMinutes]).toEqual([
    1, 1440,
  ])
})

test("active scans last 30 seconds unless the config says otherwise", () => {
  const decodeSync = Schema.decodeUnknownSync(HumiConfig)
  expect(activeScanSeconds(decodeSync({ mac, ...intervals }))).toBe(30)
  expect(
    activeScanSeconds(decodeSync({ mac, ...intervals, activeScanSeconds: 12 }))
  ).toBe(12)
  expect(decode({ mac, ...intervals, activeScanSeconds: 0 })._tag).toBe(
    "Failure"
  )
})
