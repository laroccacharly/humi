import { Effect, Option } from "effect"
import { Push } from "effect-lib/push"

/**
 * Sends a Pushover notification titled "humi", with the credentials stored by
 * `humi login`. A failed alert is only logged, so it never stops the
 * collector.
 */
export const alert: (message: string) => Effect.Effect<void, never, Push> =
  Effect.fn("alert")(function* alert(message: string) {
    const push = yield* Push
    yield* push.notify(message, { title: "humi" }).pipe(
      Effect.andThen(Effect.logInfo(`Alert sent: ${message}`)),
      Effect.catch((error) =>
        Effect.logWarning(`Alert failed: ${message}`, error.message)
      )
    )
  })

/** How long the plug may go unheard before an alert. */
export const silenceAlertMinutes = 10

/** When the plug was last heard, and whether its silence was alerted. */
export interface PlugWatch {
  readonly lastHeard: number
  readonly alerted: boolean
}

/**
 * Updates the watch for a plug scan at `now` (epoch millis): alerts once when
 * the plug has been silent for `silenceAlertMinutes`, and once more when it
 * is heard again.
 */
export const watchPlug = (
  watch: PlugWatch,
  heard: boolean,
  now: number
): readonly [PlugWatch, Option.Option<string>] => {
  if (heard) {
    return [
      { lastHeard: now, alerted: false },
      watch.alerted ? Option.some("Plug is reachable again") : Option.none(),
    ]
  }
  if (!watch.alerted && now - watch.lastHeard >= silenceAlertMinutes * 60_000) {
    const since = new Date(watch.lastHeard).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })
    return [
      { ...watch, alerted: true },
      Option.some(
        `Plug unreachable since ${since}: is it powered, in range, and not connected to the SwitchBot app?`
      ),
    ]
  }
  return [watch, Option.none()]
}
