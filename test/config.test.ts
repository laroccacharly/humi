import { expect, test } from "bun:test"

import { Schema } from "effect"

import { HumiConfig } from "../src/config.ts"

const decode = Schema.decodeUnknownExit(HumiConfig)
const mac = "EC:0F:01:46:10:4A"

test("accepts an address and a frequency", () => {
  expect(decode({ mac, every: 5 })._tag).toBe("Success")
})

test("rejects a malformed address and frequencies cron cannot express", () => {
  for (const input of [
    { mac: "EC:0F:01:46:10", every: 1 },
    { mac: "ec:0f:01:46:10:4a", every: 1 },
    { mac, every: 0 },
    { mac, every: 60 },
    { mac, every: 1.5 },
  ]) {
    expect(decode(input)._tag).toBe("Failure")
  }
})
