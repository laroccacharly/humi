# Humidity tracker hardware

Search results from 2026-10-02 (Canada). Prices may have changed since.

## Option 1: Ready-made Bluetooth sensors (recommended)

A Raspberry Pi (e.g. the picam Pi, if it has built-in Bluetooth) listens for the sensors' broadcasts and forwards readings to a Cloudflare Worker.

### Govee H5075 (pick, ~$17–20 CAD)

2×AAA, ~1 year battery, ±3% RH. Bluetooth broadcasts are well documented; Home Assistant reads them without changing the firmware.

- [Govee H5075, single](https://www.amazon.ca/Govee-Hygrometer-Thermometer-Temperature-Greenhouse/dp/B08746Z6X3)
- [Govee, 2-pack](https://www.amazon.ca/Govee-Hygrometer-Thermometer-Bluetooth-Humidity/dp/B08KG6KZF5)
- [Govee mini Bluetooth version](https://www.amazon.ca/Govee-Hygrometer-Thermometer-Wireless-Bluetooth/dp/B0GKFJZ6YS)

### SwitchBot (~$16–20 CAD)

The IP65 model is waterproof, which helps in a bathroom.

- [SwitchBot IP65 Indoor/Outdoor, $15.99 or 3 for $49.99](https://www.amazon.ca/SwitchBot-Hygrometer-Thermometer-Bluetooth-Refrigerator/dp/B0BVLYPYT1)
- [SwitchBot Meter Plus, $19.99](https://www.amazon.ca/SwitchBot-Thermometer-Hygrometer-Temperature-Notification/dp/B09QBR7XJD)

### Xiaomi (cheapest, needs custom firmware)

No confirmed Amazon.ca listing for the exact LYWSD03MMC; it's usually bought on AliExpress.

- [Xiaomi option on Amazon.ca](https://www.amazon.ca/Applicable-Temperature-Electronic-Thermometer-Hygrometer/dp/B0GVMTWVHG): a "Sensor 3", not the LYWSD03MMC. Check it's on the pvvx firmware's supported list before buying.
- [pvvx web flasher](https://pvvx.github.io/ATC_MiThermometer/TelinkMiFlasher.html): flashes the firmware from the browser over Bluetooth.
- [Original ATC_MiThermometer firmware](https://github.com/atc1441/atc_MiThermometer)
- [ESPHome pvvx_mithermometer docs](https://esphome.io/components/display/pvvx_mithermometer.html)

## Option 2: DIY Wi-Fi sensor

- [Adafruit SHT41 sensor, STEMMA QT, US$5.95](https://www.adafruit.com/product/5776): ±1.8% RH, built-in heater, no soldering.
- [Adafruit QT Py ESP32-C3, US$9.95](https://adafruit.com/product/5405): tiny Wi-Fi + Bluetooth board with a STEMMA QT port ([CircuitPython page](https://circuitpython.org/board/adafruit_qtpy_esp32c3/)).
- Adafruit ESP32-C6 Feather: battery charger and low-power design, better for battery power later.
- A STEMMA QT / Qwiic cable to connect the two.

Buying in Canada: Digi-Key Canada carries Adafruit parts and avoids surprise customs fees. Search part numbers 5776 (SHT41) and 5405 (QT Py ESP32-C3).

## Shopping list

1. Govee H5075 2-pack on Amazon.ca (~$30): one in the bathroom, one elsewhere to compare.
2. Later, optional: SHT41 + QT Py ESP32-C3 + cable from Digi-Key (~$25).
