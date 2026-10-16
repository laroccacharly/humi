import { expect, test } from "bun:test"

import { lightpanda } from "@lightpanda/browser"
import { chromium } from "playwright-core"

import { withServer } from "./seeded-server.ts"

/** A port nothing listens on, for Lightpanda's CDP server. */
const freePort = () => {
  const probe = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(),
  })
  const { port } = probe
  void probe.stop()
  return port
}

// Lightpanda runs the page's JavaScript but draws nothing, so this checks
// what the UI rendered from the seeded readings, not the chart's lines.
test("the UI shows the latest readings", async () => {
  const metrics = await withServer(async (url) => {
    const port = freePort()
    const browserProcess = await lightpanda.serve({ host: "127.0.0.1", port })
    try {
      const browser = await chromium.connectOverCDP(`ws://127.0.0.1:${port}`)
      try {
        const page = await browser.newPage()
        await page.goto(url.href)
        // The values arrive with `/api/readings`, after the first render.
        await page.locator("button.metric", { hasText: "°C" }).waitFor()
        return await page.locator("button.metric").allTextContents()
      } finally {
        await browser.close()
      }
    } finally {
      browserProcess.kill()
    }
  })
  expect(metrics).toEqual([
    "Temperature18°C",
    "Humidity45%",
    "Power40 W",
    "Battery97%",
  ])
}, 10_000)
