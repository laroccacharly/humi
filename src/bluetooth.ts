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
 * Passive advertisement monitor for SwitchBot broadcasts: manufacturer data
 * (AD type 255) starting with the company id, little-endian. A sampling
 * period of 0 forwards every broadcast instead of only the first one.
 */
const monitorCommands = [
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
 * Access to BlueZ through `bluetoothctl`.
 *
 * While the layer is in scope it keeps a passive advertisement monitor
 * registered, so BlueZ listens for the meter without ever sending it scan
 * requests. Requires `humi setup-bluetooth` once.
 *
 * The monitor's pattern is applied by the controller, which then drops every
 * packet without SwitchBot manufacturer data, including the scan response
 * that carries the battery. `activeScan` therefore pauses the monitor.
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
    /** Actively scans for a while; the only way to get scan response data. */
    readonly activeScan: (
      seconds: number
    ) => Effect.Effect<void, BluetoothError>
  }
>()("humi/Bluetooth") {
  static readonly layer = Layer.effect(
    Bluetooth,
    Effect.gen(function* bluetoothLayer() {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

      // The monitor lives as long as this bluetoothctl session, so stdin is
      // kept open after the commands are sent.
      const monitor = spawner
        .exitCode(
          ChildProcess.make("bluetoothctl", [], {
            ...quiet,
            stdin: Stream.concat(
              Stream.make(new TextEncoder().encode(monitorCommands)),
              Stream.never
            ),
          })
        )
        .pipe(
          Effect.tapError((cause) =>
            Effect.logWarning("bluetoothctl monitor failed", cause)
          ),
          // Retries forever, so it never actually fails.
          Effect.retry(Schedule.spaced("5 seconds")),
          Effect.orDie,
          Effect.forever
        )

      const monitorHandle = yield* FiberHandle.make<never, never>()
      const startMonitor = FiberHandle.run(monitorHandle, monitor).pipe(
        Effect.asVoid
      )
      yield* startMonitor

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
        yield* FiberHandle.clear(monitorHandle)
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
            Effect.ensuring(startMonitor)
          )
      })

      return Bluetooth.of({ info, devices, forget, activeScan })
    })
  )
}
