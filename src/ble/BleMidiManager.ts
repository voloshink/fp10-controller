/**
 * BleMidiManager
 *
 * Handles all Bluetooth LE MIDI communication with a Roland FP-10.
 *
 * ── BLE-MIDI framing (TX) ─────────────────────────────────────────────────────
 *   Single-packet SysEx:
 *     [Header=0x80] [Timestamp=0x80] [0xF0 … data …] [Timestamp=0x80] [0xF7]
 *   Timestamp bits all zero is valid per spec.
 *
 * ── Roland DT1 write ─────────────────────────────────────────────────────────
 *   F0 41 10 00 00 00 28 12 <addr:4> 00 <value> <checksum> F7
 *   Checksum = (128 - (sum(addr, value) % 128)) % 128
 *
 * ── Roland RQ1 read request ───────────────────────────────────────────────────
 *   F0 41 10 00 00 00 28 11 <addr:4> <size:4> <checksum> F7
 *   Checksum = (128 - (sum(addr, size) % 128)) % 128
 *   Piano responds via DT1 notification:
 *   F0 41 10 00 00 00 28 12 <addr:4> <data…> <checksum> F7
 *
 * ── BLE-MIDI framing (RX) ────────────────────────────────────────────────────
 *   Each notification packet starts with a header byte (always strip).
 *   Within SysEx, bytes with bit7=1 immediately before F0 or F7 are
 *   BLE-MIDI timestamp bytes — skip them.  All other bytes are MIDI data,
 *   even if bit7=1 (e.g. BPM values 128–240).
 *   Multi-packet SysEx is reassembled across notification calls.
 *
 * ── Confirmed addresses ───────────────────────────────────────────────────────
 *   Tempo             01 00 03 09  DT1 value = 2-byte 7-bit BPM (20–240)
 *   Metronome toggle  01 00 05 09  DT1 value = 0x00 (trigger); piano echoes state at 01 00 01 0F
 *   Metronome volume  01 00 02 21  DT1 value = 0x01–0x0A (1–10)
 *   Piano volume      01 00 02 13  DT1 value = 0x00–0x64 (0–100)
 */

import { BleManager, BleError, Characteristic, Device, State } from 'react-native-ble-plx';

// ─── Constants ────────────────────────────────────────────────────────────────

const BLE_MIDI_SERVICE        = '03B80E5A-EDE8-4B33-A751-6CE34EC4C700';
const BLE_MIDI_CHARACTERISTIC = '7772E5DB-3868-4112-A1A9-F2669D106BF3';
const TARGET_NAME             = 'FP-10';
const SCAN_TIMEOUT_MS         = 15_000;

const KNOWN_PERIPHERAL_UUIDS: string[] = [
  'ECF3331E-1D75-085D-7440-016F231AB403',
];

const ROLAND_HEADER    = [0xf0, 0x41, 0x10, 0x00, 0x00, 0x00, 0x28, 0x12];
const ROLAND_HEADER_RQ = [0xf0, 0x41, 0x10, 0x00, 0x00, 0x00, 0x28, 0x11];

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function bytesToBase64(bytes: number[]): string {
  const C = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = i+1 < bytes.length ? bytes[i+1] : 0,
          b2 = i+2 < bytes.length ? bytes[i+2] : 0;
    out += C[b0 >> 2];
    out += C[((b0 & 3) << 4) | (b1 >> 4)];
    out += i+1 < bytes.length ? C[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i+2 < bytes.length ? C[b2 & 63] : '=';
  }
  return out;
}

function base64ToBytes(b64: string): number[] {
  const C = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const out: number[] = [];
  let buf = 0, bits = 0;
  for (const ch of b64) {
    const idx = C.indexOf(ch);
    if (idx < 0) continue;
    buf = (buf << 6) | idx; bits += 6;
    if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 0xff); }
  }
  return out;
}

function hex(bytes: number[]): string {
  return bytes.map(b => b.toString(16).padStart(2, '0')).join(' ');
}

function rolandChecksum(dataBytes: number[]): number {
  const sum = dataBytes.reduce((a, b) => a + b, 0);
  return (128 - (sum % 128)) % 128;
}

/**
 * Roland DT1 write SysEx.
 *
 * dataBytes is the full data field (1 or more 7-bit bytes).  All bytes
 * must be ≤ 0x7F — SysEx data bytes with bit 7 set are illegal (the piano
 * silently ignores the command).  Multi-byte values use Roland's 7-bit
 * encoding: e.g. BPM 150 → [0x01, 0x16] because 1×128 + 22 = 150.
 */
function buildDT1(addr: number[], dataBytes: number[]): number[] {
  const cs = rolandChecksum([...addr, ...dataBytes]);
  return [...ROLAND_HEADER, ...addr, ...dataBytes, cs, 0xf7];
}

/** Roland RQ1 read-request SysEx (sizeBytes = 4-byte size field) */
function buildRQ1(addr: number[], sizeBytes: number[]): number[] {
  const cs = rolandChecksum([...addr, ...sizeBytes]);
  return [...ROLAND_HEADER_RQ, ...addr, ...sizeBytes, cs, 0xf7];
}

/** Max ATT payload for BLE-MIDI Write Without Response (MTU 23 − 3). */
const BLE_MIDI_MTU = 20;

/**
 * BLE-MIDI 13-bit timestamp from the current time.
 * Returns [headerByte, timestampByte] with bit 7 set on both.
 */
function bleMidiTimestamp(): [number, number] {
  const ms = Date.now() % 8192;
  const header = 0x80 | ((ms >> 7) & 0x3f);
  const ts     = 0x80 | (ms & 0x7f);
  return [header, ts];
}

/**
 * BLE-MIDI TX framing: wrap a SysEx with header + timestamps.
 *
 * Returns an array of packets (each ≤ BLE_MIDI_MTU bytes).
 * CoreBluetooth silently drops WriteWithoutResponse values that exceed
 * the negotiated ATT MTU.  The FP-10 negotiates MTU 23 (20 byte payload).
 * Roland Piano Partner 2 splits SysEx across multiple writes at this limit.
 *
 * Single-packet: [header, ts, F0, data…, ts, F7]
 * Multi-packet:  [header, ts, F0, data…]  +  [header, ts, F7]
 *                (continuation packets for longer messages in between)
 */
function bleMidiWrap(sysex: number[]): number[][] {
  const [header, ts] = bleMidiTimestamp();

  if (sysex[sysex.length - 1] !== 0xf7) {
    // Not a complete SysEx — just prefix with header+ts
    return [[header, ts, ...sysex]];
  }

  // Complete SysEx — try single packet first
  const body = sysex.slice(0, -1); // everything except F7
  const single = [header, ts, ...body, ts, 0xf7];
  if (single.length <= BLE_MIDI_MTU) {
    return [single];
  }

  // Must split.  First packet: [header, ts, F0, body_data…]
  // Last packet:  [header, ts, F7]
  // (middle continuation packets if needed: [header, body_data…])
  const packets: number[][] = [];
  const firstMax = BLE_MIDI_MTU - 2; // header + ts take 2 bytes
  packets.push([header, ts, ...body.slice(0, firstMax)]);
  let offset = firstMax;

  while (offset < body.length) {
    const remaining = body.length - offset;
    const lastPacketDataCap = BLE_MIDI_MTU - 3; // header + ts + F7
    if (remaining <= lastPacketDataCap) {
      // Fits in last packet with ts+F7
      packets.push([header, ...body.slice(offset), ts, 0xf7]);
      offset = body.length;
    } else {
      // Middle continuation: [header, data…]
      const chunk = BLE_MIDI_MTU - 1; // header takes 1 byte
      packets.push([header, ...body.slice(offset, offset + chunk)]);
      offset += chunk;
    }
  }

  // If body fit exactly in first packet(s), still need the F7 packet
  if (packets[packets.length - 1][packets[packets.length - 1].length - 1] !== 0xf7) {
    packets.push([header, ts, 0xf7]);
  }

  return packets;
}

// ─── BLE-MIDI RX reassembler ──────────────────────────────────────────────────

/**
 * Stateful reassembler that strips BLE-MIDI framing from incoming notification
 * packets and emits complete SysEx messages.
 *
 * BLE-MIDI RX framing rules applied here:
 *   • Byte 0 of every packet = header → always discard.
 *   • A byte with bit7=1 immediately before F0 = timestamp → discard.
 *   • A byte with bit7=1 immediately before F7 = timestamp → discard.
 *   • All other bytes (even those with bit7=1, e.g. BPM > 127) = MIDI data.
 */
class SysExReassembler {
  private buf: number[] = [];
  private inSysex = false;

  /** Feed one raw BLE notification payload; returns any complete SysEx found. */
  push(packet: number[]): number[][] {
    const complete: number[][] = [];
    // Skip header byte (packet[0]) and iterate the rest
    for (let i = 1; i < packet.length; i++) {
      const b    = packet[i];
      const peek = packet[i + 1]; // undefined if last byte

      if (this.inSysex) {
        if ((b & 0x80) && peek === 0xf7) {
          // Timestamp before F7 — discard this byte, F7 handled next iteration
          continue;
        }
        if (b === 0xf7) {
          this.buf.push(0xf7);
          complete.push([...this.buf]);
          this.buf = [];
          this.inSysex = false;
        } else {
          // Normal data byte inside SysEx (bit7=1 allowed — e.g. BPM > 127)
          this.buf.push(b);
        }
      } else {
        if ((b & 0x80) && peek === 0xf0) {
          // Timestamp before F0 — discard
          continue;
        }
        if (b === 0xf0) {
          this.buf = [0xf0];
          this.inSysex = true;
        }
        // Non-SysEx MIDI bytes ignored
      }
    }
    return complete;
  }

  reset() { this.buf = []; this.inSysex = false; }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConnectionStatus =
  | 'idle' | 'scanning' | 'connecting' | 'connected' | 'error';

export type LogFn = (
  level: 'info' | 'warn' | 'error' | 'ble',
  msg: string,
) => void;

/** Callback fired when the piano sends a DT1 parameter value. */
export type ParamCallback = (addr: number[], data: number[]) => void;

export interface ScanCallbacks {
  onFound:   (device: Device) => void;
  onError:   (err: Error) => void;
  onTimeout: () => void;
}

// ─── Manager ─────────────────────────────────────────────────────────────────

export class BleMidiManager {
  private readonly ble:   BleManager;
  private device:         Device | null = null;
  private disconnectSub:  { remove(): void } | null = null;
  private midiNotifySub:  { remove(): void } | null = null;
  private onDisconnectCb: (() => void) | null = null;
  private onParamCb:      ParamCallback | null = null;
  private log:            LogFn;
  private rx =            new SysExReassembler();

  constructor(log?: LogFn) {
    this.ble = new BleManager();
    this.log = log ?? ((_, m) => console.log(m));
  }

  destroy()          { this.disconnectSub?.remove(); this.ble.destroy(); }
  setLogFn(fn: LogFn){ this.log = fn; }
  onDisconnect(cb: () => void)    { this.onDisconnectCb = cb; }
  /** Register a callback for all DT1 responses / proactive piano notifications. */
  onParam(cb: ParamCallback)      { this.onParamCb = cb; }

  // ── Bluetooth state ────────────────────────────────────────────────────────

  waitForPoweredOn(timeoutMs = 6_000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { sub.remove(); reject(new Error('Bluetooth slow to start')); }, timeoutMs);
      const sub = this.ble.onStateChange((state) => {
        this.log('info', `BLE state → ${state}`);
        if (state === State.PoweredOn) {
          clearTimeout(timer); sub.remove(); resolve();
        } else if ([State.PoweredOff, State.Unauthorized, State.Unsupported].includes(state)) {
          clearTimeout(timer); sub.remove();
          reject(new Error(`Bluetooth unavailable (${state})`));
        }
      }, true);
    });
  }

  // ── Scanning ───────────────────────────────────────────────────────────────

  startScan(callbacks: ScanCallbacks): () => void {
    let finished = false;
    const done = (fn: () => void) => {
      if (finished) return; finished = true; this.ble.stopDeviceScan(); fn();
    };
    const tid = setTimeout(() => done(callbacks.onTimeout), SCAN_TIMEOUT_MS);
    this.findDevice(done, callbacks, tid);
    return () => { clearTimeout(tid); done(() => {}); };
  }

  private async findDevice(
    done: (fn: () => void) => void,
    cb: ScanCallbacks,
    tid: ReturnType<typeof setTimeout>,
  ) {
    // 1. Already connected (iOS auto-reconnect to bonded devices)
    this.log('info', 'Checking already-connected BLE MIDI devices…');
    try {
      for (const d of await this.ble.connectedDevices([BLE_MIDI_SERVICE])) {
        const name = d.name ?? d.localName ?? '(no name)';
        this.log('ble', `Already connected: "${name}"  id=${d.id}`);
        if (name === TARGET_NAME || d.localName === TARGET_NAME) {
          clearTimeout(tid); done(() => cb.onFound(d)); return;
        }
      }
    } catch (e) { this.log('warn', `connectedDevices error: ${e}`); }

    // 2. CoreBluetooth cache
    this.log('info', 'Checking CoreBluetooth cache…');
    try {
      for (const d of await this.ble.devices(KNOWN_PERIPHERAL_UUIDS)) {
        const name = d.name ?? d.localName ?? '(no name)';
        this.log('ble', `Cached: "${name}"  id=${d.id}`);
        if (name === TARGET_NAME || d.localName === TARGET_NAME) {
          clearTimeout(tid); done(() => cb.onFound(d)); return;
        }
      }
    } catch (e) { this.log('warn', `devices cache error: ${e}`); }

    // 3. Live scan
    this.log('info', 'Starting live BLE scan…');
    this.ble.startDeviceScan(null, { allowDuplicates: false }, (err, device) => {
      if (err) { clearTimeout(tid); done(() => cb.onError(err)); return; }
      if (device) {
        const name = device.name ?? device.localName ?? '(no name)';
        this.log('ble', `Found: "${name}"  id=${device.id}`);
        if (name === TARGET_NAME || device.localName === TARGET_NAME) {
          clearTimeout(tid); done(() => cb.onFound(device));
        }
      }
    });
  }

  // ── Connection ─────────────────────────────────────────────────────────────

  async connect(
    device: Device,
    onProgress?: (label: string, pct: number) => void,
  ): Promise<void> {
    onProgress?.('Connecting…', 0.20);
    this.log('info', `Connecting to ${device.name ?? device.id}…`);
    const connected = await device.connect({ autoConnect: false });

    onProgress?.('Discovering services…', 0.35);
    this.log('info', 'Connected — discovering services…');
    await connected.discoverAllServicesAndCharacteristics();
    this.log('info', 'Services discovered');

    for (const svc of await connected.services()) {
      this.log('ble', `Service: ${svc.uuid}`);
      for (const c of await svc.characteristics()) {
        this.log('ble', `  Char: ${c.uuid}  write=${c.isWritableWithoutResponse}`);
      }
    }

    this.device = connected;
    this.rx.reset();

    const onNotify = (error: BleError | null, char: Characteristic | null) => {
      if (error) { this.log('warn', `MIDI RX error: ${error.message}`); return; }
      if (!char?.value) return;
      const bytes = base64ToBytes(char.value);
      this.log('ble', `RX: ${hex(bytes)}`);
      for (const sysex of this.rx.push(bytes)) {
        this.handleSysEx(sysex);
      }
    };

    // ── FP-10 initialization sequence ────────────────────────────────────────
    // PacketLogger trace of Roland Piano Partner 2 (Feb 27 2026) shows:
    //
    //   1. Read the MIDI characteristic
    //   2. Write CCCD = 0x0001  (enable notifications)
    //   3. Send RQ1 bulk reads to [01,00,07,00] and [01,00,08,00]
    //      → piano responds with DT1 notifications
    //   4. DT1 write commands work after this
    //
    // Key insight: Roland sends RQ1 (read requests) as its first MIDI
    // commands, never DT1 directly.  The piano on fresh boot may only
    // accept RQ1, and processing one may transition it to full operational
    // mode where DT1 writes are also accepted.

    // Step 1 — Read the MIDI characteristic (matches Roland app)
    onProgress?.('Enabling MIDI…', 0.48);
    try {
      const readResult = await this.ble.readCharacteristicForDevice(
        connected.id, BLE_MIDI_SERVICE, BLE_MIDI_CHARACTERISTIC,
      );
      this.log('ble', `Read MIDI char: ${readResult.value ?? '(null)'}`);
    } catch (e: any) {
      this.log('warn', `Read MIDI char failed: ${e.message}`);
    }

    // Step 2 — Enable notifications (single CCCD write)
    this.midiNotifySub?.remove();
    this.midiNotifySub = connected.monitorCharacteristicForService(
      BLE_MIDI_SERVICE, BLE_MIDI_CHARACTERISTIC, onNotify,
    );
    this.log('info', 'MIDI notifications enabled');

    // Brief pause so the CCCD write completes on the wire before we send data
    await new Promise<void>(resolve => setTimeout(resolve, 200));

    // Step 3 — Send RQ1 bulk reads (matches Roland Piano Partner 2 init)
    //
    // The piano requires RQ1 initialization before accepting DT1 commands.
    // Roland sends two RQ1 reads; the piano responds with DT1 notifications
    // and enters operational mode.
    //
    // CRITICAL: RQ1 SysEx is 18 bytes → BLE-MIDI wrapped = 21 bytes.
    // This exceeds the 20-byte ATT payload limit (FP-10 MTU=23).
    // CoreBluetooth silently drops WriteWithoutResponse values > MTU.
    // bleMidiWrap() now splits into two packets (≤20 + 3), matching Roland.
    //
    // Sizes derived from Roland's DT1 responses:
    //   [01,00,07,00] → 8 data bytes  → size [0,0,0,8]
    //   [01,00,08,00] → 1 data byte   → size [0,0,0,1]
    onProgress?.('Initialising…', 0.60);
    this.log('info', 'Sending RQ1 init sequence…');
    await this.writeSysEx(buildRQ1([0x01, 0x00, 0x07, 0x00], [0x00, 0x00, 0x00, 0x08]));
    await this.writeSysEx(buildRQ1([0x01, 0x00, 0x08, 0x00], [0x00, 0x00, 0x00, 0x01]));

    // Step 4 — Identity Request to device 0x10 (matches Roland)
    this.log('info', 'Sending Identity Request…');
    await this.writeSysEx([0xf0, 0x7e, 0x10, 0x06, 0x01, 0xf7]);
    await new Promise<void>(resolve => setTimeout(resolve, 300));

    // Step 5 — Bulk RQ1 read of system area (matches Roland)
    // Roland reads [01,00,00,00] which returns model name "CF15C_0001_GL..."
    // This may be required before the piano accepts DT1 writes.
    this.log('info', 'Sending bulk system RQ1…');
    await this.writeSysEx(buildRQ1([0x01, 0x00, 0x00, 0x00], [0x00, 0x00, 0x00, 0x7f]));
    await new Promise<void>(resolve => setTimeout(resolve, 500));

    // Step 6 — Broadcast Identity Request (matches Roland)
    this.log('info', 'Sending broadcast Identity Request…');
    await this.writeSysEx([0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7]);
    await new Promise<void>(resolve => setTimeout(resolve, 300));

    // Step 7 — Studio Set initialization (matches Roland)
    // Roland sends these DT1 writes before bulk-reading System Common.
    onProgress?.('Loading piano state…', 0.75);
    this.log('info', 'Sending Studio Set init…');
    await this.writeSysEx(buildDT1([0x01, 0x00, 0x03, 0x06], [0x01]));
    await this.writeSysEx(buildDT1([0x01, 0x00, 0x03, 0x00], [0x00, 0x01]));

    // Step 8 — Bulk read System Common + Studio Set Common (matches Roland)
    // The System Common area includes [01,00,01,0f] (metronome state).
    // Reading this may activate the metronome subsystem.
    onProgress?.('Syncing settings…', 0.88);
    this.log('info', 'Reading System Common + Studio Set Common…');
    await this.writeSysEx(buildRQ1([0x01, 0x00, 0x01, 0x00], [0x00, 0x00, 0x01, 0x00]));
    await this.writeSysEx(buildRQ1([0x01, 0x00, 0x02, 0x00], [0x00, 0x00, 0x01, 0x00]));
    await new Promise<void>(resolve => setTimeout(resolve, 500));

    onProgress?.('Ready', 1.0);
    this.log('info', 'Piano ready — init complete');

    this.disconnectSub?.remove();
    this.disconnectSub = this.ble.onDeviceDisconnected(connected.id, () => {
      this.device = null;
      this.disconnectSub?.remove(); this.disconnectSub = null;
      this.rx.reset();
      this.onDisconnectCb?.();
    });
  }

  async disconnect(): Promise<void> {
    this.log('info', 'Disconnecting…');
    this.midiNotifySub?.remove(); this.midiNotifySub = null;
    this.disconnectSub?.remove(); this.disconnectSub = null;
    this.rx.reset();
    if (this.device) {
      await this.device.cancelConnection().catch(() => {});
      this.device = null;
    }
  }

  get isConnected() { return this.device !== null; }

  // ── SysEx RX parser ───────────────────────────────────────────────────────

  private handleSysEx(sysex: number[]): void {
    this.log('ble', `SysEx: ${hex(sysex)}`);

    // Only handle Roland DT1 responses: F0 41 10 00 00 00 28 12 ...
    if (
      sysex.length < 14 ||
      sysex[1] !== 0x41 || sysex[2] !== 0x10 ||
      sysex[7] !== 0x12
    ) return;

    // Layout: [F0 41 10 00 00 00 28 12] [addr:4] [data:N] [checksum] [F7]
    const addr = sysex.slice(8, 12);
    // data = everything between address and the last 2 bytes (checksum, F7)
    const data = sysex.slice(12, sysex.length - 2);

    this.log('info',
      `DT1 ← addr=[${hex(addr)}]  data=[${hex(data)}]`,
    );
    this.onParamCb?.(addr, data);
  }

  // ── MIDI write ─────────────────────────────────────────────────────────────

  private async writeSysEx(sysex: number[]): Promise<void> {
    if (!this.device) throw new Error('Not connected to FP-10');
    const packets = bleMidiWrap(sysex);
    for (const pkt of packets) {
      this.log('ble', `TX: ${hex(pkt)} (${pkt.length}B)`);
      await this.device.writeCharacteristicWithoutResponseForService(
        BLE_MIDI_SERVICE, BLE_MIDI_CHARACTERISTIC, bytesToBase64(pkt),
      );
    }
  }

  // ── FP-10 write commands ───────────────────────────────────────────────────

  async sendTempo(bpm: number): Promise<void> {
    const v = Math.max(20, Math.min(240, Math.round(bpm)));
    // Roland 7-bit 2-byte encoding: BPM = byte0 × 128 + byte1
    // This matches how the piano broadcasts BPM (01 00 01 08) and keeps all
    // SysEx data bytes ≤ 0x7F (required by MIDI spec — higher bytes have
    // bit 7 set and are interpreted as status bytes, silently aborting SysEx).
    const data = [Math.floor(v / 128), v % 128];
    await this.writeSysEx(buildDT1([0x01, 0x00, 0x03, 0x09], data));
  }

  async sendMetronomeToggle(): Promise<void> {
    // [01,00,05,09] is a TRIGGER register — writing 0x00 toggles the
    // metronome on/off.  The piano confirms the new state via a DT1
    // notification at [01,00,01,0f] (0x00=off, 0x01=on).
    // Writing any other value (e.g. 0x01) is silently ignored.
    await this.writeSysEx(buildDT1([0x01, 0x00, 0x05, 0x09], [0x00]));
  }

  async sendMetronomeVolume(volume: number): Promise<void> {
    // [01,00,02,21] — direct set, single byte, range 0x01–0x0A (1–10).
    // Confirmed via PacketLogger trace (Feb 28 2026).
    const v = Math.max(1, Math.min(10, Math.round(volume)));
    await this.writeSysEx(buildDT1([0x01, 0x00, 0x02, 0x21], [v]));
  }

  async sendPianoVolume(volume: number): Promise<void> {
    // [01,00,02,13] — direct set, single byte, range 0x00–0x64 (0–100).
    // Confirmed via PacketLogger trace (Feb 28 2026).
    const v = Math.max(0, Math.min(100, Math.round(volume)));
    await this.writeSysEx(buildDT1([0x01, 0x00, 0x02, 0x13], [v]));
  }

  // ── FP-10 read requests (RQ1) ─────────────────────────────────────────────
  //
  // ⚠️  CAUTION — the FP-10 disconnects if it receives an RQ1 for an address
  // it does not support.  The Roland Piano Partner 2 app reads bulk blocks at
  // 01 00 07 00 and 01 00 08 00 (not the individual write addresses).
  // Do not call requestParam() until the correct bulk addresses and offsets
  // are confirmed via PacketLogger.
  //
  // The infrastructure is kept here for future use.

  /**
   * Ask the piano for the current value at addr (1 byte).
   * Response arrives via the onParam callback.
   * Only call this with confirmed readable addresses.
   */
  async requestParam(addr: number[], size = 1): Promise<void> {
    const sizeBytes = [0x00, 0x00, 0x00, size];
    const sysex = buildRQ1(addr, sizeBytes);
    this.log('ble', `RQ1 → addr=[${hex(addr)}] size=${size}`);
    await this.writeSysEx(sysex);
  }
}
