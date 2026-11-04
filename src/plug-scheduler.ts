import { Effect, Option, Ref } from "effect"
import type { Push } from "effect-lib/push"

import { alert } from "./alert.ts"
import type { HumiConfig } from "./config.ts"
import type { PlugError, PlugState } from "./plug.ts"

/** The plug to schedule and its humidity thresholds, when all are configured. */
export interface PlugSchedule {
  readonly plugMac: string
  readonly onHumidity: number
  readonly offHumidity: number
}

/** The plug schedule, or none when any of its settings is missing. */
export const plugSchedule = (config: HumiConfig): Option.Option<PlugSchedule> =>
  Option.all({
    plugMac: Option.fromUndefinedOr(config.plugMac),
    onHumidity: Option.fromUndefinedOr(config.plugOnHumidity),
    offHumidity: Option.fromUndefinedOr(config.plugOffHumidity),
  })

/**
 * The state the plug should be in for `humidity`: on at or above
 * `onHumidity`, off at or below `offHumidity`. In between there is no target
 * state, so the plug stays as it is (hysteresis).
 */
export const targetState = (
  humidity: number,
  schedule: PlugSchedule
): Option.Option<PlugState> => {
  if (humidity >= schedule.onHumidity) {
    return Option.some("on")
  }
  if (humidity <= schedule.offHumidity) {
    return Option.some("off")
  }
  return Option.none()
}

/** Switches in a row the plug must ignore before an alert. */
export const alertAfterAttempts = 3

/**
 * The state the plug should be in, the switches sent since it last reported
 * that state, and how the last one failed, as ": message", or "" when the
 * command went through.
 */
interface Expected {
  readonly state: PlugState
  readonly attempts: number
  readonly failure: string
}

/**
 * Keeps the plug in the expected state, judged by `reported`, the state the
 * plug last broadcast. The expected state follows `targetState`, and between
 * the thresholds stays the last one crossed. The plug can accept a command
 * and still ignore it, so whenever it reports another state it is switched
 * again. A plug still in the wrong state after `alertAfterAttempts` switches
 * in a row raises an alert, and it reaching the expected state after that
 * raises another. An unheard plug is left alone; its silence alerts on its
 * own.
 */
export const plugScheduler: <R>(
  schedule: PlugSchedule,
  switchTo: (state: PlugState) => Effect.Effect<void, PlugError, R>
) => Effect.Effect<
  (
    humidity: number,
    reported: Option.Option<PlugState>
  ) => Effect.Effect<void, never, R | Push>
> = Effect.fnUntraced(function* plugScheduler<R>(
  schedule: PlugSchedule,
  switchTo: (state: PlugState) => Effect.Effect<void, PlugError, R>
) {
  const expected = yield* Ref.make(Option.none<Expected>())
  return Effect.fn("updatePlug")(function* updatePlug(
    humidity: number,
    reported: Option.Option<PlugState>
  ) {
    const previous = yield* Ref.get(expected)
    const state = targetState(humidity, schedule).pipe(
      Option.orElse(() => previous.pipe(Option.map((e) => e.state)))
    )
    if (Option.isNone(state)) {
      return
    }
    const target = state.value
    // A new expected state starts its attempts over.
    const { attempts, failure } = previous.pipe(
      Option.filter((e) => e.state === target),
      Option.getOrElse(() => ({ attempts: 0, failure: "" }))
    )
    if (Option.isNone(reported)) {
      yield* Ref.set(
        expected,
        Option.some({ state: target, attempts, failure })
      )
      return
    }
    if (reported.value === target) {
      if (attempts > alertAfterAttempts) {
        yield* alert(`Plug is ${target} as scheduled again`)
      }
      yield* Ref.set(
        expected,
        Option.some({ state: target, attempts: 0, failure: "" })
      )
      return
    }
    if (attempts === alertAfterAttempts) {
      yield* alert(
        `Plug still ${reported.value} after ${attempts} attempts to turn it ${target} at ${humidity}% humidity${failure}. Retrying on every reading.`
      )
    }
    const nextFailure = yield* switchTo(target).pipe(
      Effect.andThen(Effect.logInfo(`Plug ${target} at ${humidity}% humidity`)),
      Effect.as(""),
      Effect.catch((error) =>
        Effect.logWarning(
          `Plug ${target} failed, retrying on the next reading`,
          error
        ).pipe(Effect.as(`: ${error.message}`))
      )
    )
    yield* Ref.set(
      expected,
      Option.some({
        state: target,
        attempts: attempts + 1,
        failure: nextFailure,
      })
    )
  })
})
