import { expect, test } from "bun:test"

import { Effect } from "effect"

import { decodeReadings } from "../src/shared/api.ts"
import { withServer } from "./seeded-server.ts"

test("serves the UI page", async () => {
  const { status, html } = await withServer(async (url) => {
    const page = await fetch(url)
    return { status: page.status, html: await page.text() }
  })
  // `serve` builds the UI before listening, so the page is the built one.
  expect(status).toBe(200)
  expect(html).toContain("<title>humi</title>")
})

test("serves the last 14 days of readings, oldest first", async () => {
  const body = await withServer(async (url) => {
    const response = await fetch(new URL("/api/readings", url))
    const json: unknown = await response.json()
    return json
  })
  const data = await Effect.runPromise(decodeReadings(body))
  expect(data.passive).toHaveLength(24)
  expect(data.passive.map((row) => row.humidity)).not.toContain(99)
  expect(data.passive.at(-1)?.humidity).toBe(45)
  expect(data.active.map((row) => row.battery)).toEqual([97])
})
