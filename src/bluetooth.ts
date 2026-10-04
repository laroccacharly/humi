import {
  Context,
  Effect,
  FiberHandle,
  Layer,
  Schedule,
  Schema,
  Stream,
} from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"

import { switchbotCompanyId } from "./switchbot.ts"

/** Raised when `bluetoothctl` cannot be run. */
export class BluetoothError extends Schema.TaggedError<BluetoothError>()(
  "BluetoothError",
  {
    cause: Schema.Defect(),
  }
) {}

/**
 * Passive scan for SwitchBot broadcasts, as a BlueZ advertisement monitor: manufacturer data
 * (AD type 255) starting with the company id, little-endian. A sampling
 * period of 0 forwards every broadcast instead of only the first one.
 */
const passiveScanCommands = [
  "monitor.set-rssi-sampling-period 0",
  `monitor.add-or-pattern 0 255 ${switchbotCompanyId.slice(4)}${switchbotCompanyId.slice(2, 4)}`,
  "",
].join("\n")

// bluetoothctl prints a line per advertisement. Nobody reads it, and an unread
// pipe fills up and blocks bluetoothctl so it cannot handle SIGTERM, hence
// `ignore`; `forceKillAfter` is the backstop.
const quiet = {
  stdout: "ignore",
  stderr: "ignore",
  forceKillAfter: "3 seconds",
} as const

/**
 * Access to BlueZ through `bluetoothctl`, with two kinds of scan:
 *
 * - Passive scan: runs for as long as the layer is in scope. BlueZ listens
 *   for the meter's broadcasts without ever sending it scan requests.
 *   Requires `humi setup-bluetooth` once.
 * - Active scan (`activeScan`): on demand. Sends scan requests, which is the
 *   only way to get the scan response that carries the battery.
 *
 * The passive scan's pattern is applied by the controller, which then drops
 * every packet without SwitchBot manufacturer data, including that scan
 * response. `activeScan` therefore pauses the passive scan.
 */
export class Bluetooth extends Context.Service<
  Bluetooth,
  {
    readonly info: (mac: string) => Effect.Effect<string, BluetoothError>
    /** `bluetoothctl devices`: every device BlueZ currently knows about. */
    readonly devices: Effect.Effect<string, BluetoothError>
    /**
     * Drops what BlueZ cached about an unpaired device, so the next `info`
     * only shows advertisements received from now on.
     */
    readonly forget: (mac: string) => Effect.Effect<void, BluetoothError>
    /** Active scan for a while, pausing the passive scan meanwhile. */
    readonly activeScan: (
      seconds: number
    ) => Effect.Effect<void, BluetoothError>
  }
>()("humi/Bluetooth") {
  static readonly layer = Layer.effect(
    Bluetooth,
    Effect.gen(function* bluetoothLayer() {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

      // The passive scan lives as long as this bluetoothctl session, so stdin
      // is kept open after the commands are sent.
      const passiveScan = spawner
        .exitCode(
          ChildProcess.make("bluetoothctl", [], {
            ...quiet,
            stdin: Stream.concat(
              Stream.make(new TextEncoder().encode(passiveScanCommands)),
              Stream.never
            ),
          })
        )
        .pipe(
          Effect.tapError((cause) =>
            Effect.logWarning("bluetoothctl passive scan failed", cause)
          ),
          // Retries forever, so it never actually fails.
          Effect.retry(Schedule.spaced("5 seconds")),
          Effect.orDie,
          Effect.forever
        )

      const passiveScanHandle = yield* FiberHandle.make<never, never>()
      const startPassiveScan = FiberHandle.run(
        passiveScanHandle,
        passiveScan
      ).pipe(Effect.asVoid)
      yield* startPassiveScan

      const info: (mac: string) => Effect.Effect<string, BluetoothError> =
        Effect.fn("Bluetooth.info")(function* info(mac: string) {
          return yield* spawner
            .string(ChildProcess.make("bluetoothctl", ["info", mac]))
            .pipe(Effect.mapError((cause) => new BluetoothError({ cause })))
        })

      const devices = spawner
        .string(ChildProcess.make("bluetoothctl", ["devices"]))
        .pipe(
          Effect.mapError((cause) => new BluetoothError({ cause })),
          Effect.withSpan("Bluetooth.devices")
        )

      // `remove` exits non-zero when BlueZ has nothing cached, which is fine.
      const forget: (mac: string) => Effect.Effect<void, BluetoothError> =
        Effect.fn("Bluetooth.forget")(function* forget(mac: string) {
          yield* spawner
            .exitCode(ChildProcess.make("bluetoothctl", ["remove", mac], quiet))
            .pipe(Effect.mapError((cause) => new BluetoothError({ cause })))
        })

      const activeScan: (
        seconds: number
      ) => Effect.Effect<void, BluetoothError> = Effect.fn(
        "Bluetooth.activeScan"
      )(function* activeScan(seconds: number) {
        yield* FiberHandle.clear(passiveScanHandle)
        yield* spawner
          .exitCode(
            ChildProcess.make(
              "bluetoothctl",
              ["--timeout", String(seconds), "scan", "le"],
              quiet
            )
          )
          .pipe(
            Effect.mapError((cause) => new BluetoothError({ cause })),
            Effect.ensuring(startPassiveScan)
          )
      })

      return Bluetooth.of({ info, devices, forget, activeScan })
    })
  )
}
