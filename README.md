# FP-10 Controller

An Expo / React Native iOS app that connects to a **Roland FP-10 digital piano**
via Bluetooth LE MIDI and controls its built-in metronome.

---

## Features

| Feature | Detail |
|---|---|
| BLE scan & connect | Scans for a device named `FP-10`, connects automatically |
| Connection status | Live indicator: idle / scanning / connecting / connected / error |
| Tempo control | Slider (20–240 BPM) + ±1 / ±10 buttons with long-press repeat |
| Metronome toggle | ON/OFF button; state tracked locally |
| Downbeat toggle | ON/OFF button; direct set command (not a toggle) |

---

## Project structure

```
piano-app/
├── App.tsx                        Root component
├── app.json                       Expo config + BLE plugin
├── src/
│   ├── theme.ts                   Colour palette, typography, spacing
│   ├── ble/
│   │   └── BleMidiManager.ts      BLE MIDI class (scanning, connecting, SysEx)
│   ├── hooks/
│   │   └── useBleMidi.ts          React hook wrapping BleMidiManager
│   └── components/
│       ├── ConnectionCard.tsx     Scan / disconnect UI
│       ├── TempoControl.tsx       Slider + ±buttons
│       └── ToggleCard.tsx         Reusable on/off toggle card
```

---

## Prerequisites

- **macOS** with Xcode 15+ installed
- **Node.js** 18+
- **Expo CLI** (`npm i -g expo-cli` or use `npx expo`)
- A physical **iPhone** (BLE MIDI does not work in the simulator)
- **Roland FP-10** powered on with Bluetooth enabled

---

## Setup & run

```bash
# 1. Install dependencies
npm install

# 2. Generate native iOS project (required for react-native-ble-plx)
npx expo prebuild --platform ios

# 3. Build & run on a connected device
npx expo run:ios --device
```

> **Why not `expo start`?**  
> `react-native-ble-plx` is a native module. It cannot run in Expo Go or the
> JS-only dev server. You need a development build (`expo run:ios`).

---

## BLE MIDI protocol details

### Framing

Every BLE write is prepended with two bytes (Bluetooth MIDI Specification §3):

```
[0x80, 0x80, ...sysExBytes]
 ^^^^   ^^^^
 header  timestamp byte (before first MIDI status)
 byte    Both zero-timestamp → safe for all receivers
```

### Roland DT1 SysEx format

```
F0 41 10 00 00 00 28 12  <addr: 4 bytes>  00  <value>  <checksum>  F7
                         ─────────────── ──  ───────  ──────────
                           address         │   data     Roland sum
                                       fixed sep.
```

**Checksum** (Roland standard):

```ts
const bytes = [...addressBytes, value];       // 4 addr bytes + value
const sum   = bytes.reduce((a, b) => a + b, 0);
const checksum = (128 - (sum % 128)) % 128;
```

The fixed `00` separator always precedes the value byte in every captured
FP-10 packet. Because its value is zero it does not affect the checksum.

### Commands

| Function | Address | Value |
|---|---|---|
| Tempo | `01 00 03 09` | BPM byte (20–240) |
| Metronome toggle | `01 00 05 09` | `0x71` always (piano flip-flops) |
| Downbeat on | `01 00 02 23` | `0x01` |
| Downbeat off | `01 00 02 23` | `0x00` |

### UUIDs

| | UUID |
|---|---|
| Service | `03B80E5A-EDE8-4B33-A751-6CE34EC4C700` |
| Characteristic | `7772E5DB-3868-4112-A1A9-F2669D106BF3` |

---

## Metronome state caveat

The FP-10 does not expose its current metronome state over BLE.  
The app defaults to **OFF** on connect and toggles locally.  
If the piano's metronome was already running when you connected, the first
tap will turn it **off** (they will re-sync after one tap).

---

## iOS permissions

`react-native-ble-plx`'s Expo plugin (configured in `app.json`) automatically
adds `NSBluetoothAlwaysUsageDescription` to `Info.plist` during `expo prebuild`.
No manual Xcode changes needed.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| "FP-10 not found" after 15 s | Check the piano is on, BT is on, within ~5 m |
| "Bluetooth unavailable (Unauthorized)" | Go to iOS Settings → Privacy → Bluetooth → enable for the app |
| Tempo changes but metronome doesn't respond | Make sure the metronome is enabled on the piano first |
| Build fails with native module error | Run `npx expo prebuild --clean` then rebuild |
