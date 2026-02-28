# Agent Instructions

## BLE-MIDI Debugging Tools

### Parse PacketLogger traces
```bash
node tools/parse-trace.mjs /path/to/trace.txt
```
Decodes PacketLogger text exports into readable Roland SysEx. Supports both text and **Raw Data** exports (Raw Data is preferred — no truncation). Handles multi-packet SysEx reassembly, Roland DT1/RQ1 decoding, MIDI Identity messages, checksum verification, and named address lookup.

### Parse app logs
```bash
pbpaste | node tools/parse-applog.mjs
```
Same decoding for React Native LOG output. Copy logs from Metro bundler, pipe in. Decodes TX/RX hex lines into Roland DT1/RQ1 with named addresses, checksums, BPM values, and metronome state.

### PacketLogger export tips
- **Always use Raw Data export** — text export truncates payloads at 16 bytes, hiding RQ1 sizes and checksums
- Filter by "FP-10" device in PacketLogger to reduce noise
- Key ATT handles: `0x0010` = MIDI characteristic, `0x0011` = CCCD descriptor

## Roland FP-10 BLE-MIDI Protocol

### Key addresses
| Address | Name | Data |
|---------|------|------|
| `01 00 01 0f` | Metronome State | RX only: `00`=off, `01`=on (notification) |
| `01 00 03 09` | Tempo | 2 bytes: `[high, low]` → BPM = high×128 + low |
| `01 00 05 09` | Metronome Toggle | TRIGGER: write `[00]` to toggle; other values ignored |
| `01 00 02 23` | Downbeat | 2 bytes: `[00, 01]`=on, `[00, 00]`=off |
| `01 00 07 00` | System Info Block 1 | 8 bytes (RQ1 init, size=8) |
| `01 00 08 00` | System Info Block 2 | 1 byte (RQ1 init, size=1) |

### Init sequence (matches Roland Piano Partner 2)
1. Read MIDI characteristic (handle 0x0010)
2. Write CCCD = 0x0001 (enable notifications, handle 0x0011)
3. RQ1 `[01,00,07,00]` size=8 → piano responds with DT1
4. RQ1 `[01,00,08,00]` size=1 → piano responds with DT1
5. Identity Request `F0 7E 10 06 01 F7`
6. DT1 commands work after this

### BLE-MIDI packet size limit
- FP-10 negotiates ATT MTU 23 → **20-byte payload max**
- CoreBluetooth **silently drops** WriteWithoutResponse values exceeding MTU
- RQ1 SysEx (18 bytes) wraps to 21 bytes BLE-MIDI → must split into 2 packets
- DT1 SysEx (15-17 bytes) wraps to 18-20 bytes → fits in single packet
- `bleMidiWrap()` handles splitting automatically

### SysEx format
```
DT1: F0 41 10 00 00 00 28 12 [addr:4] [data:N] [checksum] F7
RQ1: F0 41 10 00 00 00 28 11 [addr:4] [size:4] [checksum] F7
Checksum: (128 - (sum(addr, data_or_size) % 128)) % 128
```

## Project structure
- `src/ble/BleMidiManager.ts` — all BLE-MIDI communication
- `tools/parse-trace.mjs` — PacketLogger trace decoder
- `tools/parse-applog.mjs` — app log decoder
- `INVESTIGATION.md` — detailed debug history
