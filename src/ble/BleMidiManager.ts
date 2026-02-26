/**
 * BleMidiManager
 *
 * Handles all Bluetooth LE MIDI communication with a Roland FP-10 digital
 * piano.  Each public method corresponds to one FP-10 SysEx command.
 *
 * BLE-MIDI framing (Bluetooth MIDI Specification §3):
 *   Every BLE write begins with two bytes:
 *     • Header  0x80 | timestamp_high[5:0]  (0x80 when timestamp = 0)
 *     • Before every MIDI status byte: 0x80 | timestamp_low[6:0]  (0x80 when 0)
 *   So the full packet is: [0x80, 0x80, ...sysexBytes]
 *
 * Roland DT1 SysEx format:
 *   F0 41 10 00 00 00 28 12 <addr:4> 00 <value> <checksum> F7
 *   Checksum = (128 - ((addr[0]+addr[1]+addr[2]+addr[3]+value) % 128)) % 128
 *
 * Confirmed addresses (from packet sniffing):
 *   Tempo      01 00 03 09  value = BPM (20–240)
 *   Metronome  01 00 05 09  value = 0x71 always (piano toggles internally)
 *   Downbeat   01 00 02 23  value = 0x01 (on) | 0x00 (off)
 */

import { BleManager, Device, State } from 'react-native-ble-plx';

// ─── Constants ────────────────────────────────────────────────────────────────

const BLE_MIDI_SERVICE        = '03B80E5A-EDE8-4B33-A751-6CE34EC4C700';
const BLE_MIDI_CHARACTERISTIC = '7772E5DB-3868-4112-A1A9-F2669D106BF3';
const TARGET_NAME             = 'FP-10';

/**
 * CoreBluetooth peripheral UUIDs previously observed for this piano.
 * iOS uses these stable UUIDs to identify cached/bonded peripherals even when
 * the device isn't actively advertising.  Add new ones from PacketLogger as
 * you find them.
 */
const KNOWN_PERIPHERAL_UUIDS: string[] = [
  'ECF3331E-1D75-085D-7440-016F231AB403', // seen in PacketLogger Feb 26
];
const SCAN_TIMEOUT_MS         = 15_000;

/** Roland SysEx header: F0 41 10 00 00 00 28 12 */
const ROLAND_HEADER = [0xf0, 0x41, 0x10, 0x00, 0x00, 0x00, 0x28, 0x12];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Encode a byte array to base64 without relying on Buffer or TextEncoder,
 * both of which can be absent in stock Hermes environments.
 */
function bytesToBase64(bytes: number[]): string {
  const CHARS =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += CHARS[b0 >> 2];
    out += CHARS[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? CHARS[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? CHARS[b2 & 0x3f] : '=';
  }
  return out;
}

/**
 * Roland checksum: (128 - (sum % 128)) % 128
 * Covers the 4 address bytes + the value byte (the fixed 0x00 separator that
 * appears in every captured packet is zero, so it does not affect the sum).
 */
function rolandChecksum(addr: number[], value: number): number {
  const bytes = [...addr, value];
  const sum   = bytes.reduce((a, b) => a + b, 0);
  return (128 - (sum % 128)) % 128;
}

/**
 * Build a complete Roland DT1 SysEx message.
 * addr must be exactly 4 bytes (as documented for FP-10).
 */
function buildSysEx(addr: readonly number[], value: number): number[] {
  const checksum = rolandChecksum([...addr], value);
  return [
    ...ROLAND_HEADER,
    ...addr,
    0x00,       // constant separator observed in every FP-10 capture
    value,
    checksum,
    0xf7,
  ];
}

/**
 * Wrap a SysEx byte array in BLE-MIDI framing.
 * Timestamp = 0 throughout (valid per spec; piano accepts it).
 */
function bleMidiPacket(sysex: number[]): number[] {
  // Header byte (0x80) + timestamp byte (0x80) before first status byte (0xF0)
  return [0x80, 0x80, ...sysex];
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConnectionStatus =
  | 'idle'
  | 'scanning'
  | 'connecting'
  | 'connected'
  | 'error';

export interface ScanCallbacks {
  onFound:      (device: Device) => void;
  onError:      (err: Error) => void;
  onTimeout:    () => void;
}

// ─── Manager class ────────────────────────────────────────────────────────────

export type LogFn = (level: 'info' | 'warn' | 'error' | 'ble', msg: string) => void;

export class BleMidiManager {
  private readonly ble: BleManager;
  private device:        Device | null = null;
  private disconnectSub: { remove(): void } | null = null;
  private onDisconnectCb: (() => void) | null = null;
  private log: LogFn;

  constructor(log?: LogFn) {
    this.ble = new BleManager();
    this.log = log ?? ((_, msg) => console.log(msg));
  }

  /** Free native resources. Call from a useEffect cleanup. */
  destroy() {
    this.disconnectSub?.remove();
    this.ble.destroy();
  }

  /** Swap the log function after construction (e.g. once a React hook is ready). */
  setLogFn(fn: LogFn) {
    this.log = fn;
  }

  /** Register a callback invoked whenever the piano disconnects unexpectedly. */
  onDisconnect(cb: () => void) {
    this.onDisconnectCb = cb;
  }

  // ── Bluetooth state ────────────────────────────────────────────────────────

  /**
   * Resolves when BT is powered on; rejects if it is unavailable/unauthorised.
   * Emits the current state immediately so it resolves instantly when BT is
   * already ready.
   */
  waitForPoweredOn(timeoutMs = 6_000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        sub.remove();
        reject(new Error('Bluetooth is taking too long to start. Is it enabled?'));
      }, timeoutMs);

      const sub = this.ble.onStateChange((state) => {
        this.log('info', `BLE state → ${state}`);
        if (state === State.PoweredOn) {
          clearTimeout(timer);
          sub.remove();
          resolve();
        } else if (
          state === State.PoweredOff ||
          state === State.Unauthorized ||
          state === State.Unsupported
        ) {
          clearTimeout(timer);
          sub.remove();
          reject(new Error(`Bluetooth unavailable (${state}). Check Settings.`));
        }
        // State.Unknown / State.Resetting — keep waiting
      }, true /* emitCurrentState */);
    });
  }

  // ── Scanning ───────────────────────────────────────────────────────────────

  /**
   * Try to find the FP-10 via three strategies in order:
   *   1. Already connected to iOS at the system level (connectedDevices)
   *   2. Cached by CoreBluetooth from a previous session (devices by UUID)
   *   3. Active BLE scan
   *
   * Returns a stop() function the caller can invoke early.
   */
  startScan(callbacks: ScanCallbacks): () => void {
    let finished = false;

    const done = (fn: () => void) => {
      if (finished) return;
      finished = true;
      this.ble.stopDeviceScan();
      fn();
    };

    const timeoutId = setTimeout(
      () => done(callbacks.onTimeout),
      SCAN_TIMEOUT_MS,
    );

    // Run async strategies, fall through to live scan
    this.findDevice(done, callbacks, timeoutId);

    return () => {
      clearTimeout(timeoutId);
      done(() => {});
    };
  }

  private async findDevice(
    done: (fn: () => void) => void,
    callbacks: ScanCallbacks,
    timeoutId: ReturnType<typeof setTimeout>,
  ) {
    // ── Strategy 1: already connected at OS level ──────────────────────────
    this.log('info', 'Checking for already-connected BLE MIDI devices…');
    try {
      const connected = await this.ble.connectedDevices([BLE_MIDI_SERVICE]);
      this.log('info', `Connected devices: ${connected.length}`);
      for (const d of connected) {
        const name = d.name ?? d.localName ?? '(no name)';
        this.log('ble', `Already connected: "${name}"  id=${d.id}`);
        if (name === TARGET_NAME || d.localName === TARGET_NAME) {
          this.log('info', `✓ Found ${TARGET_NAME} already connected — reusing`);
          clearTimeout(timeoutId);
          done(() => callbacks.onFound(d));
          return;
        }
      }
    } catch (e: unknown) {
      this.log('warn', `connectedDevices() error: ${String(e)}`);
    }

    // ── Strategy 2: known peripheral UUIDs cached by CoreBluetooth ─────────
    this.log('info', 'Checking CoreBluetooth peripheral cache…');
    try {
      // Pass common UUIDs seen in PacketLogger / previous sessions
      const known = await this.ble.devices(KNOWN_PERIPHERAL_UUIDS);
      this.log('info', `Cached peripherals: ${known.length}`);
      for (const d of known) {
        const name = d.name ?? d.localName ?? '(no name)';
        this.log('ble', `Cached: "${name}"  id=${d.id}`);
        if (name === TARGET_NAME || d.localName === TARGET_NAME) {
          this.log('info', `✓ Found ${TARGET_NAME} in cache — using it`);
          clearTimeout(timeoutId);
          done(() => callbacks.onFound(d));
          return;
        }
      }
    } catch (e: unknown) {
      this.log('warn', `devices() cache error: ${String(e)}`);
    }

    // ── Strategy 3: live scan ───────────────────────────────────────────────
    this.log('info', 'Starting live BLE scan…');

    this.ble.startDeviceScan(
      null,                       // no service-UUID filter — FP-10 may not advertise it
      { allowDuplicates: false },
      (error, device) => {
        if (error) {
          this.log('error', `Scan error: ${error.message}`);
          clearTimeout(timeoutId);
          done(() => callbacks.onError(error));
          return;
        }
        if (device) {
          const name = device.name ?? device.localName ?? '(no name)';
          this.log('ble', `Found: "${name}"  id=${device.id}`);

          if (name === TARGET_NAME || device.localName === TARGET_NAME) {
            this.log('info', `✓ Matched ${TARGET_NAME} — stopping scan`);
            clearTimeout(timeoutId);
            done(() => callbacks.onFound(device));
          }
        }
      },
    );
  }

  // ── Connection ─────────────────────────────────────────────────────────────

  async connect(device: Device): Promise<void> {
    this.log('info', `Connecting to ${device.name ?? device.id}…`);
    const connected = await device.connect({ autoConnect: false });
    this.log('info', 'Connected — discovering services…');
    await connected.discoverAllServicesAndCharacteristics();
    this.log('info', 'Services discovered — ready');

    // Log available services so we can verify the MIDI service is present
    const services = await connected.services();
    for (const svc of services) {
      this.log('ble', `Service: ${svc.uuid}`);
      const chars = await svc.characteristics();
      for (const c of chars) {
        this.log('ble', `  Char: ${c.uuid}  write=${c.isWritableWithoutResponse}`);
      }
    }

    this.device = connected;

    // Subscribe to disconnection events
    this.disconnectSub?.remove();
    this.disconnectSub = this.ble.onDeviceDisconnected(
      connected.id,
      (_err, _dev) => {
        this.device = null;
        this.disconnectSub?.remove();
        this.disconnectSub = null;
        this.onDisconnectCb?.();
      },
    );
  }

  async disconnect(): Promise<void> {
    this.log('info', 'Disconnecting…');
    this.disconnectSub?.remove();
    this.disconnectSub = null;
    if (this.device) {
      await this.device.cancelConnection().catch(() => {});
      this.device = null;
    }
    this.log('info', 'Disconnected');
  }

  get isConnected(): boolean {
    return this.device !== null;
  }

  // ── MIDI write ─────────────────────────────────────────────────────────────

  private async writeSysEx(sysex: number[]): Promise<void> {
    if (!this.device) throw new Error('Not connected to FP-10');
    const packet = bleMidiPacket(sysex);
    const hex    = packet.map((b) => b.toString(16).padStart(2, '0')).join(' ');
    this.log('ble', `TX: ${hex}`);
    const b64    = bytesToBase64(packet);
    await this.device.writeCharacteristicWithoutResponseForService(
      BLE_MIDI_SERVICE,
      BLE_MIDI_CHARACTERISTIC,
      b64,
    );
  }

  // ── FP-10 commands ─────────────────────────────────────────────────────────

  /**
   * Set metronome tempo (20–240 BPM).
   * Address: 01 00 03 09
   */
  async sendTempo(bpm: number): Promise<void> {
    const clamped = Math.max(20, Math.min(240, Math.round(bpm)));
    await this.writeSysEx(buildSysEx([0x01, 0x00, 0x03, 0x09], clamped));
  }

  /**
   * Toggle metronome on/off.  The piano acts as a flip-flop: value 0x71 is
   * always sent; the piano handles state internally.
   * Address: 01 00 05 09
   */
  async sendMetronomeToggle(): Promise<void> {
    await this.writeSysEx(buildSysEx([0x01, 0x00, 0x05, 0x09], 0x71));
  }

  /**
   * Enable or disable the downbeat accent (beat-1 accent).
   * Address: 01 00 02 23  value: 0x01 = on, 0x00 = off
   */
  async sendDownbeat(on: boolean): Promise<void> {
    await this.writeSysEx(buildSysEx([0x01, 0x00, 0x02, 0x23], on ? 0x01 : 0x00));
  }
}
