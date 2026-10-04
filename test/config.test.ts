import { expect, test } from "bun:test"

import { Schema } from "effect"

import { activeScanSeconds, HumiConfig } from "../src/config.ts"

const decode = Schema.decodeUnknownExit(HumiConfig)
const mac = "EC:0F:01:46:10:4A"
const intervals = { passiveScanMinutes: 1, activeScanMinutes: 1440 }

test("accepts an address and a frequency", () => {
  expect(decode({ mac, ...intervals })._tag).toBe("Success")
})

test("rejects a malformed address and intervals under a minute", () => {
  for (const input of [
    { mac: "EC:0F:01:46:10", ...intervals },
    { mac: "ec:0f:01:46:10:4a", ...intervals },
    { mac, ...intervals, passiveScanMinutes: 0 },
    { mac, ...intervals, activeScanMinutes: 1.5 },
    { mac, passiveScanMinutes: 1 },
  ]) {
    expect(decode(input)._tag).toBe("Failure")
  }
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
