# FP-10 Controller

An Expo / React Native iOS app that connects to a **Roland FP-10 digital piano**
via Bluetooth LE MIDI and controls its built-in metronome.

---

## Features

| Feature | Detail |
|---|---|
| BLE scan & connect | Finds `FP-10` via `connectedDevices()`, cache, or live scan |
| Connection status | Live indicator: idle / scanning / connecting / connected / error |
| Tempo control | Slider (20–240 BPM) + ±1 / ±10 buttons with long-press repeat |
| Metronome toggle | ON/OFF button; state tracked via piano notifications |
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
├── tools/
│   ├── parse-trace.mjs            Decode PacketLogger exports → Roland SysEx
│   └── parse-applog.mjs           Decode app logs → Roland SysEx
├── AGENTS.md                      Agent instructions & protocol reference
└── INVESTIGATION.md               Debug history
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

## FP-10 initialization sequence

The piano requires a specific handshake before it accepts DT1 write commands.
This was reverse-engineered from the Roland Piano Partner 2 app using
PacketLogger traces. All steps are required — skipping any causes the piano
to silently ignore DT1 writes.

| Step | Operation | Purpose |
|------|-----------|---------|
| 1 | Read MIDI characteristic (handle 0x0010) | Match Roland's sequence |
| 2 | Write CCCD = 0x0001 (handle 0x0011) | Enable BLE-MIDI notifications |
| 3 | RQ1 `[01,00,07,00]` size=8 | System info block 1 |
| 4 | RQ1 `[01,00,08,00]` size=1 | System info block 2 |
| 5 | Identity Request (ch=0x10) | MIDI device identification |
| 6 | RQ1 `[01,00,00,00]` size=127 | Bulk system read — **unlocks DT1 writes** |
| 7 | Identity Request (ch=0x7F broadcast) | Broadcast identification |
| 8 | DT1 `[01,00,03,06]` data=`[01]` | Studio Set parameter |
| 9 | DT1 `[01,00,03,00]` data=`[00,01]` | Studio Set Tone select |
| 10 | RQ1 `[01,00,01,00]` size=256 | System Common bulk read — **activates metronome** |
| 11 | RQ1 `[01,00,02,00]` size=256 | Studio Set Common bulk read |

After this sequence, DT1 write commands and metronome toggle work correctly.

---

## BLE MIDI protocol

### BLE-MIDI framing

Every BLE-MIDI packet starts with a header byte and timestamp
(BLE MIDI Specification §3):

```
[header] [timestamp] [F0 ... SysEx data ...] [timestamp] [F7]
```

Timestamps are 13-bit values derived from `Date.now() % 8192`, split across
the header (high 6 bits) and timestamp byte (low 7 bits), both with bit 7 set.

### Packet size limit (critical)

The FP-10 negotiates ATT MTU 23, giving a **20-byte ATT payload limit**.
CoreBluetooth **silently drops** `WriteWithoutResponse` values exceeding
the MTU — no error is returned.

- DT1 SysEx (15–17 bytes) → BLE-MIDI 18–20 bytes → **fits in single packet** ✓
- RQ1 SysEx (18 bytes) → BLE-MIDI 21 bytes → **must split into 2 packets**

`bleMidiWrap()` handles this automatically, splitting into:
- Packet 1 (≤20 bytes): `[header, ts, F0, body...]`
- Packet 2 (3 bytes): `[header, ts, F7]`

### Roland SysEx format

```
DT1 (write): F0 41 10 00 00 00 28 12 [addr:4] [data:N] [checksum] F7
RQ1 (read):  F0 41 10 00 00 00 28 11 [addr:4] [size:4] [checksum] F7
```

**Checksum** = `(128 - (sum(addr, data_or_size) % 128)) % 128`

### Commands

| Function | Address | Data | Notes |
|---|---|---|---|
| Metronome toggle | `01 00 05 09` | `[00]` | Trigger: write `00` to toggle; other values ignored |
| Metronome state | `01 00 01 0f` | — | RX notification: `00`=off, `01`=on |
| Tempo | `01 00 03 09` | `[high, low]` | BPM = high×128 + low (7-bit encoding) |
| Downbeat on/off | `01 00 02 23` | `[00, 01]` / `[00, 00]` | Direct set |

### BLE UUIDs

| | UUID |
|---|---|
| Service | `03B80E5A-EDE8-4B33-A751-6CE34EC4C700` |
| Characteristic | `7772E5DB-3868-4112-A1A9-F2669D106BF3` |

---

## Debugging tools

### Decode PacketLogger traces

```bash
node tools/parse-trace.mjs /path/to/trace.txt
```

Supports text and **Raw Data** exports (Raw Data preferred — no truncation).
Reassembles multi-packet SysEx, decodes Roland DT1/RQ1, MIDI Identity,
checksums, and named addresses.

### Decode app logs

```bash
pbpaste | node tools/parse-applog.mjs
```

Same decoding for React Native LOG output. Copy logs from Metro, pipe in.

### PacketLogger tips

- **Always use Raw Data export** — text export truncates payloads at 16 bytes
- Filter by "FP-10" device to reduce noise
- Key handles: `0x0010` = MIDI characteristic, `0x0011` = CCCD descriptor

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
| Init succeeds but DT1 writes ignored | Ensure full init sequence runs (all 11 steps) |
| RQ1 sent but no response | Check packet splitting — RQ1 > 20 bytes is silently dropped |
| Build fails with native module error | Run `npx expo prebuild --clean` then rebuild |
