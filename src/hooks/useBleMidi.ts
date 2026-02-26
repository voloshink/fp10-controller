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
 *
 * Downbeat flow:
 *   • Explicit set command (0x01 / 0x00), so state always matches piano.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { BleMidiManager, ConnectionStatus } from '../ble/BleMidiManager';
import { Device } from 'react-native-ble-plx';

// ─── Public shape ─────────────────────────────────────────────────────────────

export interface BleMidiState {
  // connection
  status:        ConnectionStatus;
  statusMessage: string;
  isConnected:   boolean;

  // piano controls
  tempo:        number;
  metronomeOn:  boolean;
  downbeatOn:   boolean;

  // actions
  connect:         () => void;
  disconnect:      () => void;
  setTempoLocal:   (bpm: number) => void;   // display-only, no BLE write
  sendTempo:       (bpm: number) => void;   // display + BLE write
  toggleMetronome: () => void;
  setDownbeatOn:   (on: boolean) => void;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useBleMidi(): BleMidiState {
  const mgrRef = useRef<BleMidiManager | null>(null);

  // connection
  const [status, setStatus]               = useState<ConnectionStatus>('idle');
  const [statusMessage, setStatusMessage] = useState('');

  // piano state
  const [tempo, setTempo]           = useState(120);
  const [metronomeOn, setMetronome] = useState(false);
  const [downbeatOn, setDownbeat]   = useState(true);

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  useEffect(() => {
    const mgr = new BleMidiManager();
    mgrRef.current = mgr;

    mgr.onDisconnect(() => {
      setStatus('idle');
      setStatusMessage('Piano disconnected.');
      setMetronome(false);  // reset toggled state on disconnect
    });

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
    runConnect(mgr);
  }, []);

  async function runConnect(mgr: BleMidiManager) {
    try {
      setStatusMessage('Waiting for Bluetooth…');
      await mgr.waitForPoweredOn();

      setStatusMessage(`Scanning for "${TARGET}" (15 s)…`);

      await new Promise<void>((resolve, reject) => {
        const stop = mgr.startScan({
          onFound: async (device: Device) => {
            setStatus('connecting');
            setStatusMessage(`Found ${device.name} — connecting…`);
            try {
              await mgr.connect(device);
              setStatus('connected');
              setStatusMessage(`Connected to ${device.name}`);
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
      setStatusMessage(
        err instanceof Error ? err.message : 'Connection failed.',
      );
    }
  }

  const disconnect = useCallback(async () => {
    await mgrRef.current?.disconnect();
    setStatus('idle');
    setStatusMessage('');
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

  // ── Metronome ──────────────────────────────────────────────────────────────

  const toggleMetronome = useCallback(() => {
    // Flip local mirror; the BLE command is always the same (0x71 toggle),
    // so we don't need to read the new state before sending.
    setMetronome((prev) => !prev);
    mgrRef.current?.sendMetronomeToggle().catch((e) =>
      console.warn('[FP-10] sendMetronomeToggle failed:', e),
    );
  }, []);

  // ── Downbeat ───────────────────────────────────────────────────────────────

  const setDownbeatOn = useCallback((on: boolean) => {
    setDownbeat(on);
    mgrRef.current?.sendDownbeat(on).catch((e) =>
      console.warn('[FP-10] sendDownbeat failed:', e),
    );
  }, []);

  // ── Return ─────────────────────────────────────────────────────────────────

  return {
    status,
    statusMessage,
    isConnected: status === 'connected',
    tempo,
    metronomeOn,
    downbeatOn,
    connect,
    disconnect,
    setTempoLocal,
    sendTempo,
    toggleMetronome,
    setDownbeatOn,
  };
}

// ─── Utilities ────────────────────────────────────────────────────────────────

const TARGET = 'FP-10';

function clampBpm(bpm: number): number {
  return Math.max(20, Math.min(240, Math.round(bpm)));
}
