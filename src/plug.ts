import { Array as Arr, Effect, Option, Schedule, Schema } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"

import type { PlugStatus } from "./switchbot.ts"
import { decodePlug, parseInfo } from "./switchbot.ts"

/** Raised when the plug could not be switched. */
export class PlugError extends Schema.TaggedError<PlugError>()("PlugError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

/** SwitchBot's command characteristic; commands are written to it. */
const commandUuid = "cba20002-224d-11e6-9fb8-0002a5d5c51b"

/**
 * Plug Mini commands, from OpenWonderLabs/SwitchBotAPI-BLE: `57 0f 50 01`
 * sets the relay, then `01` and `80` for on or `00` for off.
 */
const commands = {
  on: [0x57, 0x0f, 0x50, 0x01, 0x01, 0x80],
  off: [0x57, 0x0f, 0x50, 0x01, 0x01, 0x00],
} as const

export type PlugState = keyof typeof commands

/** Why a plug that is not broadcasting cannot be reached. */
const unreachable = (mac: string) =>
  `Heard nothing from ${mac}. Is the plug powered, in range, and not connected to the SwitchBot app?`

/** BlueZ's D-Bus object for a device. */
const devicePath = (mac: string) =>
  `/org/bluez/hci0/dev_${mac.toUpperCase().replaceAll(":", "_")}`

/** `GetManagedObjects` as printed by `busctl --json=short`. */
const ManagedObjects = Schema.fromJsonString(
  Schema.Struct({
    data: Schema.Tuple([
      Schema.Record(
        Schema.String,
        Schema.Record(
          Schema.String,
          Schema.Record(Schema.String, Schema.Struct({ data: Schema.Unknown }))
        )
      ),
    ]),
  })
)

/**
 * Switches a SwitchBot Plug Mini over Bluetooth through BlueZ's D-Bus API:
 * connects, writes the command, then disconnects so the plug keeps
 * advertising for the next time.
 */
export const switchPlug: (
  mac: string,
  state: PlugState
) => Effect.Effect<void, PlugError, ChildProcessSpawner.ChildProcessSpawner> =
  Effect.fn("switchPlug")(function* switchPlug(mac: string, state: PlugState) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const device = devicePath(mac)
    const busctl = (message: string, args: readonly string[]) =>
      spawner
        .string(ChildProcess.make("busctl", ["--system", ...args]))
        .pipe(Effect.mapError((cause) => new PlugError({ message, cause })))
    const exitCode = (args: readonly string[]) =>
      spawner
        .exitCode(
          ChildProcess.make(args[0] ?? "", args.slice(1), {
            stdout: "ignore",
            stderr: "ignore",
          })
        )
        .pipe(Effect.orElseSucceed(() => 1))

    // BlueZ only connects to devices it has heard lately, so scan briefly
    // when it does not know the plug yet, and give up if it still does not.
    const known = exitCode(["bluetoothctl", "info", mac]).pipe(
      Effect.map((code) => code === 0)
    )
    if (!(yield* known)) {
      yield* exitCode(["bluetoothctl", "--timeout", "5", "scan", "le"])
      if (!(yield* known)) {
        yield* new PlugError({ message: unreachable(mac) })
      }
    }

    yield* busctl(`Could not connect to ${mac}. Is the plug in range?`, [
      "call",
      "org.bluez",
      device,
      "org.bluez.Device1",
      "Connect",
    ]).pipe(Effect.retry({ times: 2, schedule: Schedule.spaced("1 second") }))

    // The characteristics appear once BlueZ has resolved the services, which
    // can take a moment after the connection.
    const characteristic = busctl("Could not list Bluetooth objects", [
      "--json=short",
      "call",
      "org.bluez",
      "/",
      "org.freedesktop.DBus.ObjectManager",
      "GetManagedObjects",
    ]).pipe(
      Effect.flatMap((json) =>
        Schema.decodeUnknownEffect(ManagedObjects)(json).pipe(
          Effect.mapError(
            (cause) =>
              new PlugError({ message: "Unexpected busctl output", cause })
          )
        )
      ),
      Effect.flatMap(({ data: [objects] }) =>
        Arr.findFirst(
          Object.entries(objects),
          ([path, interfaces]) =>
            path.startsWith(`${device}/`) &&
            interfaces["org.bluez.GattCharacteristic1"]?.UUID?.data ===
              commandUuid
        ).pipe(
          Option.map(([path]) => path),
          Effect.fromOption,
          Effect.mapError(
            () =>
              new PlugError({
                message: `${mac} has no SwitchBot command characteristic. Is it a Plug Mini?`,
              })
          )
        )
      ),
      Effect.retry({ times: 10, schedule: Schedule.spaced("500 millis") })
    )

    yield* characteristic.pipe(
      Effect.flatMap((path) =>
        busctl(`Could not switch ${mac} ${state}`, [
          "call",
          "org.bluez",
          path,
          "org.bluez.GattCharacteristic1",
          "WriteValue",
          "aya{sv}",
          String(commands[state].length),
          ...commands[state].map(String),
          "0",
        ])
      ),
      Effect.ensuring(
        exitCode([
          "busctl",
          "--system",
          "call",
          "org.bluez",
          device,
          "org.bluez.Device1",
          "Disconnect",
        ])
      )
    )
  })

/**
 * Reads the plug's state from a broadcast heard just now, scanning for 5
 * seconds. `humi run` gets it for free from its passive scan instead.
 */
export const plugStatus: (
  mac: string
) => Effect.Effect<
  PlugStatus,
  PlugError,
  ChildProcessSpawner.ChildProcessSpawner
> = Effect.fn("plugStatus")(function* plugStatus(mac: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const run = (args: readonly string[]) =>
    spawner
      .exitCode(
        ChildProcess.make("bluetoothctl", args, {
          stdout: "ignore",
          stderr: "ignore",
        })
      )
      .pipe(Effect.orElseSucceed(() => 1))

  // Drop the cached broadcast so the status comes from one heard just now.
  yield* run(["remove", mac])
  yield* run(["--timeout", "5", "scan", "le"])
  const info = yield* spawner
    .string(ChildProcess.make("bluetoothctl", ["info", mac]))
    .pipe(
      Effect.mapError(
        (cause) => new PlugError({ message: "bluetoothctl failed", cause })
      )
    )
  return yield* decodePlug(parseInfo(info)).pipe(
    Effect.fromOption,
    Effect.mapError(
      () =>
        new PlugError({
          message: unreachable(mac),
        })
    )
  )
})
