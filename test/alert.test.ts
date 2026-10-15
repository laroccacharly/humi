import { expect, test } from "bun:test"

import { Option } from "effect"

import { silenceAlertMinutes, watchPlug } from "../src/alert.ts"

const minute = 60_000

test("alerts once when the plug goes silent, and once when it is back", () => {
  let watch = { lastHeard: 0, alerted: false }
  const scan = (heard: boolean, minutes: number) => {
    const [next, message] = watchPlug(watch, heard, minutes * minute)
    watch = next
    return Option.getOrUndefined(message)
  }

  expect(scan(false, silenceAlertMinutes - 1)).toBeUndefined()
  expect(scan(false, silenceAlertMinutes)).toContain("Plug unreachable since")
  expect(scan(false, silenceAlertMinutes + 1)).toBeUndefined()
  expect(scan(true, silenceAlertMinutes + 2)).toBe("Plug is reachable again")
  expect(scan(true, silenceAlertMinutes + 3)).toBeUndefined()
  expect(scan(false, 2 * silenceAlertMinutes + 2)).toBeUndefined()
})
