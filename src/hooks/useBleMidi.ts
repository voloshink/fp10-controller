/**
 * useBleMidi
 *
 * Single hook that owns the BleMidiManager lifecycle and exposes clean,
 * typed state + actions to the UI layer.
 *
 * Tempo flow:
 *   • setTempoLocal(bpm) — updates the displayed number immediately (slider drag)
 *   • sendTempo(bpm)     — updates local state AND writes to BLE (slider release,
 *                          +/- button press)
 *
 * Metronome flow:
 *   • The FP-10 toggles internally on every 0x71 command.
 *   • We mirror state locally starting from false (off).
 *   • A note in the UI warns the user that the first press may de-sync if the
 *     piano's metronome was already running before connecting.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { BleMidiManager, ConnectionStatus, LogFn, ParamCallback } from '../ble/BleMidiManager';
import { Device } from 'react-native-ble-plx';

// ─── Public shape ─────────────────────────────────────────────────────────────

export interface BleMidiState {
  // connection
  status:             ConnectionStatus;
  statusMessage:      string;
  connectionProgress: number;   // 0–1, only meaningful during scanning/connecting
  isConnected:        boolean;
  /** Pass this to BleMidiManager so it logs through your useLogger instance. */
  setLogFn:      (fn: LogFn) => void;

  // piano controls
  tempo:           number;
  metronomeOn:     boolean;
  metronomeVolume: number;   // 1–10
  pianoVolume:     number;   // 0–100

  // actions
  connect:               () => void;
  disconnect:            () => void;
  setTempoLocal:         (bpm: number) => void;    // display-only, no BLE write
  sendTempo:             (bpm: number) => void;    // display + BLE write
  toggleMetronome:       () => void;
  setMetronomeVolLocal:  (vol: number) => void;    // display-only, no BLE write
  sendMetronomeVolume:   (vol: number) => void;    // display + BLE write
  setPianoVolLocal:      (vol: number) => void;    // display-only, no BLE write
  sendPianoVolume:       (vol: number) => void;    // display + BLE write
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useBleMidi(): BleMidiState {
  const mgrRef = useRef<BleMidiManager | null>(null);

  // connection
  const [status, setStatus]                         = useState<ConnectionStatus>('idle');
  const [statusMessage, setStatusMessage]           = useState('');
  const [connectionProgress, setConnectionProgress] = useState(0);

  // piano state
  const [tempo, setTempo]               = useState(120);
  const [metronomeOn, setMetronome]     = useState(false);
  const [metronomeVolume, setMetVol]    = useState(5);    // mid-range default
  const [pianoVolume, setPianoVol]      = useState(100);  // max default

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  const logFnRef = useRef<LogFn | undefined>(undefined);

  const setLogFn = useCallback((fn: LogFn) => {
    logFnRef.current = fn;
    mgrRef.current?.setLogFn(fn);
  }, []);

  useEffect(() => {
    const mgr = new BleMidiManager(logFnRef.current);
    mgrRef.current = mgr;

    mgr.onDisconnect(() => {
      setStatus('idle');
      setStatusMessage('Piano disconnected.');
      setMetronome(false);
    });

    // ── Piano → app parameter updates ──────────────────────────────────────
    //
    // The piano broadcasts state changes proactively after every write (ours
    // or from the physical controls) on these addresses, confirmed by
    // PacketLogger capture on Feb 27:
    //
    //  01 00 01 08 — BPM, 2-byte 7-bit: BPM = data[0] × 128 + data[1]
    //               This fires after every tempo change (knob, app, or ours).
    //
    //  01 00 01 0F — Metronome on/off: 0x00 = off, 0x01 = on
    //               This fires after every metronome toggle.
    //
    const handleParam: ParamCallback = (addr, data) => {
      const key = addr.map(b => b.toString(16).padStart(2, '0')).join('');

      switch (key) {
        case '01000108': {
          // BPM broadcast — 2-byte 7-bit Roland encoding
          if (data.length < 2) break;
          const bpm = data[0] * 128 + data[1];
          if (bpm >= 20 && bpm <= 240) setTempo(bpm);
          break;
        }
        case '0100010f':
          // Metronome state — 0x00 = off, 0x01 = on
          if (data.length >= 1) setMetronome(data[0] === 0x01);
          break;

        case '01000213':
          // Piano volume — direct set, range 0x00–0x64 (0–100)
          if (data.length >= 1 && data[0] <= 100) setPianoVol(data[0]);
          break;

        case '01000221':
          // Metronome volume — direct set, range 0x01–0x0A (1–10)
          if (data.length >= 1 && data[0] >= 1 && data[0] <= 10) setMetVol(data[0]);
          break;

        case '01000200': {
          // Bulk DT1 response to the init RQ1 at [01,00,02,00] (size 256).
          // Piano volume at offset 0x13, metronome volume at offset 0x21.
          const pvol = data[0x13];
          if (pvol !== undefined && pvol <= 100) setPianoVol(pvol);
          const mvol = data[0x21];
          if (mvol !== undefined && mvol >= 1 && mvol <= 10) setMetVol(mvol);
          break;
        }

        // Legacy cases — if the piano echoes on the write addresses too
        case '01000309': {
          // Same 2-byte 7-bit encoding as 01 00 01 08
          if (data.length >= 2) {
            const bpm = data[0] * 128 + data[1];
            if (bpm >= 20 && bpm <= 240) setTempo(bpm);
          } else if (data.length === 1 && data[0] >= 20 && data[0] <= 127) {
            setTempo(data[0]);
          }
          break;
        }
        case '01000509':
          if (data.length >= 1) setMetronome(data[0] !== 0x00);
          break;
      }
      // All addresses (including unknown ones) are already logged by
      // BleMidiManager as "DT1 ← addr=[…] data=[…]".
    };
    mgr.onParam(handleParam);

    return () => {
      mgr.destroy();
      mgrRef.current = null;
    };
  }, []);

  // ── Connection ─────────────────────────────────────────────────────────────

  // Stable ref that holds the latest status without making connect() depend on it
  const statusRef = useRef<ConnectionStatus>('idle');

  // Keep statusRef in sync whenever status changes
  useEffect(() => { statusRef.current = status; }, [status]);

  const connect = useCallback(() => {
    const mgr = mgrRef.current;
    if (!mgr) return;
    // Guard: only one scan at a time
    if (statusRef.current === 'scanning' || statusRef.current === 'connecting') return;
    setStatus('scanning');
    setConnectionProgress(0);
    runConnect(mgr);
  }, []);

  async function runConnect(mgr: BleMidiManager) {
    try {
      setStatusMessage('Waiting for Bluetooth…');
      setConnectionProgress(0.05);
      await mgr.waitForPoweredOn();

      setStatusMessage(`Scanning for FP-10…`);
      setConnectionProgress(0.12);

      await new Promise<void>((resolve, reject) => {
        const stop = mgr.startScan({
          onFound: async (device: Device) => {
            setStatus('connecting');
            setStatusMessage(`Found ${device.name ?? TARGET}`);
            setConnectionProgress(0.18);
            try {
              await mgr.connect(device, (label, pct) => {
                setStatusMessage(label);
                setConnectionProgress(pct);
              });
              setStatus('connected');
              setStatusMessage(`Connected to ${device.name ?? TARGET}`);
              setConnectionProgress(1);
              resolve();
            } catch (err: unknown) {
              reject(err);
            }
          },
          onError: reject,
          onTimeout: () =>
            reject(
              new Error(
                `"${TARGET}" not found. Make sure the piano is on and nearby.`,
              ),
            ),
        });

        // Keep a reference so we can cancel from outside if needed
        void stop; // stop is called internally by the manager on found/error/timeout
      });
    } catch (err: unknown) {
      setStatus('error');
      setConnectionProgress(0);
      setStatusMessage(
        err instanceof Error ? err.message : 'Connection failed.',
      );
    }
  }

  const disconnect = useCallback(async () => {
    await mgrRef.current?.disconnect();
    setStatus('idle');
    setStatusMessage('');
    setConnectionProgress(0);
    setMetronome(false);
  }, []);

  // ── Tempo ──────────────────────────────────────────────────────────────────

  /** Update the displayed BPM without sending a BLE packet (slider drag). */
  const setTempoLocal = useCallback((bpm: number) => {
    setTempo(clampBpm(bpm));
  }, []);

  /** Update display AND send a SysEx tempo command. */
  const sendTempo = useCallback((bpm: number) => {
    const clamped = clampBpm(bpm);
    setTempo(clamped);
    mgrRef.current?.sendTempo(clamped).catch((e) =>
      console.warn('[FP-10] sendTempo failed:', e),
    );
  }, []);

  // ── Metronome volume ───────────────────────────────────────────────────────

  const clampMetVol = (v: number) => Math.max(1, Math.min(10, Math.round(v)));

  const setMetronomeVolLocal = useCallback((vol: number) => {
    setMetVol(clampMetVol(vol));
  }, []);

  const sendMetronomeVolume = useCallback((vol: number) => {
    const clamped = clampMetVol(vol);
    setMetVol(clamped);
    mgrRef.current?.sendMetronomeVolume(clamped).catch((e) =>
      console.warn('[FP-10] sendMetronomeVolume failed:', e),
    );
  }, []);

  // ── Piano volume ───────────────────────────────────────────────────────────

  const clampPianoVol = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

  const setPianoVolLocal = useCallback((vol: number) => {
    setPianoVol(clampPianoVol(vol));
  }, []);

  const sendPianoVolume = useCallback((vol: number) => {
    const clamped = clampPianoVol(vol);
    setPianoVol(clamped);
    mgrRef.current?.sendPianoVolume(clamped).catch((e) =>
      console.warn('[FP-10] sendPianoVolume failed:', e),
    );
  }, []);

  // ── Metronome ──────────────────────────────────────────────────────────────

  const toggleMetronome = useCallback(() => {
    // Do NOT optimistically flip state here. The piano echoes the authoritative
    // new state via DT1 notification at 01 00 01 0F (~60 ms later), which
    // handleParam uses to call setMetronome(). Optimistically flipping causes
    // a visible revert whenever app state is out of sync with the piano (e.g.
    // after reconnecting while the piano's metronome was already on).
    mgrRef.current?.sendMetronomeToggle().catch((e) =>
      console.warn('[FP-10] sendMetronomeToggle failed:', e),
    );
  }, []);

  // ── Return ─────────────────────────────────────────────────────────────────

  return {
    status,
    statusMessage,
    connectionProgress,
    isConnected: status === 'connected',
    setLogFn,
    tempo,
    metronomeOn,
    metronomeVolume,
    pianoVolume,
    connect,
    disconnect,
    setTempoLocal,
    sendTempo,
    toggleMetronome,
    setMetronomeVolLocal,
    sendMetronomeVolume,
    setPianoVolLocal,
    sendPianoVolume,
  };
}

// ─── Utilities ────────────────────────────────────────────────────────────────

const TARGET = 'FP-10';

function clampBpm(bpm: number): number {
  return Math.max(20, Math.min(240, Math.round(bpm)));
}
