# humi

Logs temperature and humidity from a SwitchBot Bluetooth meter into SQLite, charts them in a small web UI, and can switch a SwitchBot Plug Mini (e.g. a dehumidifier) on and off by humidity.

## Demo

[![humi demo](https://img.youtube.com/vi/LtPGFVgnTJw/maxresdefault.jpg)](https://youtu.be/LtPGFVgnTJw)

## Requirements

- Linux with BlueZ (`bluetoothctl`, `busctl`) and a Bluetooth adapter
- [Bun](https://bun.sh)
- A SwitchBot Indoor/Outdoor Thermo-Hygrometer (W3400010)
- Optional: a SwitchBot Plug Mini, and a [Pushover](https://pushover.net) account for alerts

## Installation

```sh
git clone https://github.com/laroccacharly/humi.git
cd humi
bun install
bun link
```
