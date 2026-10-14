import { Effect, Option, Ref } from "effect"
import type { ChildProcessSpawner } from "effect/process"

import type { HumiConfig } from "./config.ts"
import type { PlugState } from "./plug.ts"
import { switchPlug } from "./plug.ts"

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

/**
 * Moves the plug to the target state for each humidity reading.
 *
 * The current state is the last one the plug was switched to, unknown until
 * the first switch. A command is only sent when the target state differs
 * from the current state, and a failed switch leaves the current state as it
 * was, so the next reading retries it.
 */
export const plugScheduler: (
  schedule: PlugSchedule
) => Effect.Effect<
  (
    humidity: number
  ) => Effect.Effect<void, never, ChildProcessSpawner.ChildProcessSpawner>
> = Effect.fn("plugScheduler")(function* plugScheduler(schedule: PlugSchedule) {
  const currentState = yield* Ref.make(Option.none<PlugState>())
  return Effect.fn("updatePlug")(function* updatePlug(humidity: number) {
    const target = targetState(humidity, schedule)
    if (
      Option.isNone(target) ||
      Option.contains(yield* Ref.get(currentState), target.value)
    ) {
      return
    }
    yield* switchPlug(schedule.plugMac, target.value).pipe(
      Effect.andThen(Ref.set(currentState, target)),
      Effect.andThen(
        Effect.logInfo(`Plug ${target.value} at ${humidity}% humidity`)
      ),
      Effect.catch((error) =>
        Effect.logWarning(
          `Plug ${target.value} failed, retrying on the next reading`,
          error
        )
      )
    )
  })
})
