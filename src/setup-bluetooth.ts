import { Effect, Schedule, Schema } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"

/** Raised when passive Bluetooth monitoring could not be enabled. */
export class SetupError extends Schema.TaggedError<SetupError>()("SetupError", {
  message: Schema.String,
}) {}

/**
 * Enables BlueZ's experimental features, which include the advertisement
 * monitor API that humi uses for passive scanning, then restarts bluetoothd.
 * Keeps a one-time backup of the original config.
 */
const enableScript = `set -e
conf=/etc/bluetooth/main.conf
cp -n "$conf" "$conf.humi.bak"
if grep -qE '^#?[[:space:]]*Experimental[[:space:]]*=' "$conf"; then
  sed -i -E 's/^#?[[:space:]]*Experimental[[:space:]]*=.*/Experimental = true/' "$conf"
else
  sed -i '/^\\[General\\]/a Experimental = true' "$conf"
fi
systemctl restart bluetooth
`

/** Whether bluetoothd exposes the advertisement monitor API on hci0. */
export const passiveAvailable: Effect.Effect<
  boolean,
  never,
  ChildProcessSpawner.ChildProcessSpawner
> = Effect.gen(function* passiveAvailable() {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const interfaces = yield* spawner
    .string(
      ChildProcess.make("busctl", [
        "--system",
        "introspect",
        "org.bluez",
        "/org/bluez/hci0",
      ])
    )
    .pipe(Effect.orElseSucceed(() => ""))
  return interfaces.includes("org.bluez.AdvertisementMonitorManager1")
})

/** Turns on passive monitoring once; asks for the password via pkexec. */
export const setupBluetooth: () => Effect.Effect<
  void,
  SetupError,
  ChildProcessSpawner.ChildProcessSpawner
> = Effect.fn("setupBluetooth")(function* setupBluetooth() {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

  if (yield* passiveAvailable) {
    return yield* Effect.logInfo(
      "Passive Bluetooth monitoring is already enabled"
    )
  }

  yield* Effect.logInfo(
    "Enabling BlueZ experimental features; enter your password in the prompt"
  )
  const exitCode = yield* spawner
    .exitCode(ChildProcess.make("pkexec", ["sh", "-c", enableScript]))
    .pipe(
      Effect.mapError(
        (cause) =>
          new SetupError({ message: `pkexec failed: ${cause.message}` })
      )
    )
  if (exitCode !== ChildProcessSpawner.ExitCode(0)) {
    return yield* new SetupError({
      message: `Enabling experimental features exited with code ${exitCode}`,
    })
  }

  // bluetoothd takes a moment to bring the adapter back after the restart.
  yield* passiveAvailable.pipe(
    Effect.filterOrFail(
      (available) => available,
      () =>
        new SetupError({
          message: "bluetoothd restarted without the advertisement monitor API",
        })
    ),
    Effect.retry({ schedule: Schedule.spaced("1 second"), times: 15 })
  )
  return yield* Effect.logInfo("Passive Bluetooth monitoring is enabled")
})
