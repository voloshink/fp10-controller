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
 *   Tempo      01 00 03 09  DT1 value = BPM byte (20–240)
 *   Metronome  01 00 05 09  DT1 value = 0x71 toggle; RQ1 returns 0x00/0x01
 *   Downbeat   01 00 02 23  DT1 value = 0x01 on / 0x00 off
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

/** Roland RQ1 read-request SysEx (size = number of bytes to read) */
function buildRQ1(addr: number[], size = 1): number[] {
  const sizeBytes = [0x00, 0x00, 0x00, size];
  const cs = rolandChecksum([...addr, ...sizeBytes]);
  return [...ROLAND_HEADER_RQ, ...addr, ...sizeBytes, cs, 0xf7];
}

/**
 * BLE-MIDI 13-bit timestamp from the current time.
 * Returns [headerByte, timestampByte] with bit 7 set on both.
 *
 * The Roland FP-10 appears to reject BLE-MIDI packets with zero timestamps
 * (header=0x80, ts=0x80).  All Roland Piano Partner 2 packets use non-zero
 * timestamps.  The BLE-MIDI spec says zero is valid, but the piano's
 * firmware disagrees.
 */
function bleMidiTimestamp(): [number, number] {
  const ms = Date.now() % 8192; // 13-bit millisecond timestamp
  const header = 0x80 | ((ms >> 7) & 0x3f);
  const ts     = 0x80 | (ms & 0x7f);
  return [header, ts];
}

/**
 * BLE-MIDI TX framing: wrap a SysEx with header + timestamps.
 * Inserts a timestamp byte before both F0 (at position 0) and F7.
 */
function bleMidiWrap(sysex: number[]): number[] {
  const [header, ts] = bleMidiTimestamp();
  if (sysex[sysex.length - 1] === 0xf7) {
    return [header, ts, ...sysex.slice(0, -1), ts, 0xf7];
  }
  return [header, ts, ...sysex];
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
    // ── Drop any stale iOS auto-reconnect ────────────────────────────────
    // iOS auto-reconnects to bonded BLE peripherals.  If the FP-10 is
    // already connected, the piano's MIDI processor hasn't initialized
    // (it only initializes on a NEW connection event).  We must tear down
    // the stale link so the piano starts advertising again, then connect
    // fresh via scan.
    this.log('info', 'Dropping any stale BLE connection to FP-10…');
    for (const id of KNOWN_PERIPHERAL_UUIDS) {
      try {
        await this.ble.cancelDeviceConnection(id);
        this.log('info', `Cancelled existing connection: ${id}`);
      } catch (_) { /* not connected — fine */ }
    }
    // Also try via connectedDevices in case the UUID isn't in our list
    try {
      for (const d of await this.ble.connectedDevices([BLE_MIDI_SERVICE])) {
        const name = d.name ?? d.localName ?? '';
        if (name === TARGET_NAME || d.localName === TARGET_NAME) {
          this.log('info', `Cancelling auto-connected "${name}"…`);
          try { await this.ble.cancelDeviceConnection(d.id); } catch (_) {}
        }
      }
    } catch (_) {}

    // Wait for the BLE stack to fully disconnect and the piano to start
    // advertising again.
    await new Promise<void>(resolve => setTimeout(resolve, 2000));

    // Live scan only — do NOT use connectedDevices() or cache, as those
    // return stale device objects tied to the old connection.
    this.log('info', 'Starting live BLE scan…');
    this.ble.startDeviceScan(null, { allowDuplicates: false }, (err, device) => {
      if (err) { clearTimeout(tid); done(() => cb.onError(err)); return; }
      if (device) {
        const name = device.name ?? device.localName ?? '(no name)';
        if (name === TARGET_NAME || device.localName === TARGET_NAME) {
          this.log('info', `Found FP-10 via scan: id=${device.id}`);
          clearTimeout(tid); done(() => cb.onFound(device));
        }
      }
    });
  }

  // ── Connection ─────────────────────────────────────────────────────────────

  async connect(device: Device): Promise<void> {
    this.log('info', `Connecting to ${device.name ?? device.id}…`);
    const connected = await device.connect({ autoConnect: false });
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
    this.log('info', 'MIDI notifications enabled — piano ready');

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
    const packet = bleMidiWrap(sysex);
    this.log('ble', `TX: ${hex(packet)}`);
    await this.device.writeCharacteristicWithoutResponseForService(
      BLE_MIDI_SERVICE, BLE_MIDI_CHARACTERISTIC, bytesToBase64(packet),
    );
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
    await this.writeSysEx(buildDT1([0x01, 0x00, 0x05, 0x09], [0x00, 0x71]));
  }

  async sendDownbeat(on: boolean): Promise<void> {
    await this.writeSysEx(buildDT1([0x01, 0x00, 0x02, 0x23], [0x00, on ? 0x01 : 0x00]));
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
  async requestParam(addr: number[]): Promise<void> {
    const sysex = buildRQ1(addr, 1);
    this.log('ble', `RQ1 → addr=[${hex(addr)}]`);
    await this.writeSysEx(sysex);
  }
}
