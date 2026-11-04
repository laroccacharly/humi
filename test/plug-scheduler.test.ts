import { expect, test } from "bun:test"

import { Effect, Option } from "effect"
import { Push } from "effect-lib/push"

import { alertAfterAttempts, plugScheduler } from "../src/plug-scheduler.ts"
import { PlugError } from "../src/plug.ts"
import type { PlugState } from "../src/plug.ts"

const schedule = {
  plugMac: "AA:BB:CC:DD:EE:FF",
  onHumidity: 70,
  offHumidity: 50,
}

/**
 * Runs the scheduler against a plug that starts on and only obeys once
 * `ignored` commands have gone by, returning the commands sent and the
 * alerts raised.
 */
const runReadings = async (
  ignored: number,
  readings: readonly number[],
  failure: Option.Option<string> = Option.none()
) => {
  const commands: PlugState[] = []
  const alerts: string[] = []
  let plug: PlugState = "on"
  const switchTo = (state: PlugState) =>
    Effect.suspend(() => {
      commands.push(state)
      if (commands.length > ignored) {
        plug = state
      }
      return Option.match(failure, {
        onNone: () => Effect.void,
        onSome: (message) => Effect.fail(new PlugError({ message })),
      })
    })
  return await Effect.gen(function* runReadingsEffect() {
    const updatePlug = yield* plugScheduler(schedule, switchTo)
    for (const humidity of readings) {
      yield* updatePlug(humidity, Option.some(plug))
    }
    return { commands, alerts }
  }).pipe(
    Effect.provideService(Push, {
      notify: (message) => Effect.sync(() => alerts.push(message)),
    }),
    Effect.runPromise
  )
}

test("switches the plug off once it reports off", async () => {
  const { commands, alerts } = await runReadings(0, [55, 50, 50, 50])
  expect(commands).toEqual(["off"])
  expect(alerts).toEqual([])
})

test("switches again until a plug that ignored the command reports off", async () => {
  const { commands, alerts } = await runReadings(1, [50, 50, 50, 50])
  expect(commands).toEqual(["off", "off"])
  expect(alerts).toEqual([])
})

test("alerts when the plug keeps ignoring, keeps trying, and alerts when it obeys", async () => {
  const readings = Array.from({ length: 8 }, () => 50)
  const { commands, alerts } = await runReadings(5, readings)
  expect(commands).toHaveLength(6)
  expect(alerts).toEqual([
    `Plug still on after ${alertAfterAttempts} attempts to turn it off at 50% humidity. Retrying on every reading.`,
    "Plug is off as scheduled again",
  ])
})

test("does not count switches that worked across humidity cycles", async () => {
  const { commands, alerts } = await runReadings(
    0,
    [50, 60, 70, 60, 50, 60, 70]
  )
  expect(commands).toEqual(["off", "on", "off", "on"])
  expect(alerts).toEqual([])
})

test("keeps switching a plug that ignored the command once humidity is between the thresholds", async () => {
  const { commands, alerts } = await runReadings(2, [50, 51, 52, 53])
  expect(commands).toEqual(["off", "off", "off"])
  expect(alerts).toEqual([])
})

test("leaves the plug alone between the thresholds", async () => {
  const { commands } = await runReadings(0, [51, 60, 69])
  expect(commands).toEqual([])
})

test("includes the error in the alert when switching fails", async () => {
  const readings = Array.from({ length: alertAfterAttempts + 1 }, () => 50)
  const { alerts } = await runReadings(
    Infinity,
    readings,
    Option.some("Could not connect")
  )
  expect(alerts).toEqual([
    `Plug still on after ${alertAfterAttempts} attempts to turn it off at 50% humidity: Could not connect. Retrying on every reading.`,
  ])
})

test("remembers a threshold crossed while the plug is unheard", async () => {
  const commands: PlugState[] = []
  await Effect.gen(function* rememberEffect() {
    const updatePlug = yield* plugScheduler(schedule, (state) =>
      Effect.sync(() => commands.push(state))
    )
    yield* updatePlug(70, Option.some("on"))
    yield* updatePlug(50, Option.none())
    yield* updatePlug(60, Option.some("on"))
  }).pipe(
    Effect.provideService(Push, { notify: () => Effect.void }),
    Effect.runPromise
  )
  expect(commands).toEqual(["off"])
})
