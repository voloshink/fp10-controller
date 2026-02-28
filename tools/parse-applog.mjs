#!/usr/bin/env node
/**
 * Parse app log output (React Native LOG lines) and decode BLE-MIDI / Roland SysEx.
 *
 * Usage:
 *   node tools/parse-applog.mjs < log.txt
 *   # or paste logs interactively (Ctrl-D to finish)
 *   pbpaste | node tools/parse-applog.mjs
 *
 * Expects LOG lines like:
 *   LOG  [BLE] 22:21:30.960 TX: 8e d0 f0 41 10 00 00 00 28 11 01 00 07 00 00 00 00 08 70 (19B)
 *   LOG  [BLE] 22:21:31.023 RX: b4 fd f0 41 10 ...
 *   LOG  [INFO] 22:21:31.054 DT1 ← addr=[01 00 07 00]  data=[00 00 00 07 0e 0d 01 0c]
 */

import { readFileSync } from 'fs';

const input = readFileSync('/dev/stdin', 'utf-8');
const lines = input.split('\n');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseHexSpaced(s) {
  return s.trim().split(/\s+/).map(h => parseInt(h, 16)).filter(b => !isNaN(b));
}

function hex(bytes) { return bytes.map(b => b.toString(16).padStart(2, '0')).join(' '); }

function rolandChecksum(bytes) {
  return (128 - (bytes.reduce((a, b) => a + b, 0) % 128)) % 128;
}

// ─── BLE-MIDI strip (stateless) ─────────────────────────────────────────────

function stripBleMidi(raw) {
  const out = [];
  for (let i = 1; i < raw.length; i++) {
    const b = raw[i];
    const next = raw[i + 1];
    if ((b & 0x80) && (next === 0xf0 || next === 0xf7)) continue;
    out.push(b);
  }
  return out;
}

// ─── Roland decoder ─────────────────────────────────────────────────────────

const ADDRS = {
  '01 00 00 00': 'System (bulk)',
  '01 00 01 00': 'System Common',
  '01 00 01 08': 'Tempo (broadcast)',
  '01 00 02 00': 'Studio Set Common',
  '01 00 02 23': 'Downbeat',
  '01 00 03 00': 'Studio Set Tone',
  '01 00 03 06': 'Volume?',
  '01 00 03 09': 'Tempo',
  '01 00 05 09': 'Metronome',
  '01 00 07 00': 'System Info Block 1',
  '01 00 08 00': 'System Info Block 2',
  '01 00 09 00': 'Registration/User Data',
};

function decodeRoland(sysex) {
  if (sysex.length < 14 || sysex[1] !== 0x41) return null;
  const cmd = sysex[7];
  const cmdName = cmd === 0x11 ? 'RQ1' : cmd === 0x12 ? 'DT1' : `CMD:0x${cmd.toString(16)}`;
  const addr = sysex.slice(8, 12);
  const addrHex = hex(addr);
  const addrName = ADDRS[addrHex] ?? '';
  const data = sysex.slice(12, -2);
  const checksum = sysex[sysex.length - 2];
  const expectedCs = rolandChecksum([...addr, ...data]);
  const csOk = checksum === expectedCs;

  let extra = '';
  if (cmdName === 'DT1' && addrHex === '01 00 03 09') {
    const bpm = data.length === 2 ? data[0] * 128 + data[1] : data[0];
    extra = `  → BPM ${bpm}`;
  } else if (cmdName === 'DT1' && addrHex === '01 00 05 09' && data.length === 1) {
    extra = data[0] === 0 ? '  → OFF' : data[0] === 1 ? '  → ON' : `  → 0x${data[0].toString(16)}`;
  } else if (cmdName === 'RQ1' && data.length === 4) {
    const size = (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3];
    extra = `  → size=${size}`;
  }
  if (data.length > 4 && data.every(b => b >= 0x20 && b < 0x7f)) {
    extra += `  "${String.fromCharCode(...data)}"`;
  }

  return { cmdName, addrHex, addrName, data, csOk, extra };
}

function decodeMidiIdentity(sysex) {
  if (sysex.length < 5 || sysex[1] !== 0x7e) return null;
  const ch = sysex[2];
  if (sysex[3] === 0x06 && sysex[4] === 0x01) return `Identity Request (ch=${ch === 0x7f ? 'broadcast' : ch})`;
  if (sysex[3] === 0x06 && sysex[4] === 0x02 && sysex.length >= 15) {
    return `Identity Reply (ch=${ch}) mfr=${sysex[5].toString(16)} family=${hex(sysex.slice(8,10))} model=${hex(sysex.slice(10,12))}`;
  }
  return `Universal SysEx [${hex(sysex)}]`;
}

// ─── SysEx reassembler ──────────────────────────────────────────────────────

class Reassembler {
  constructor() { this.buf = []; this.inSysex = false; }
  push(bytes) {
    const out = [];
    for (const b of bytes) {
      if (b === 0xf0) { this.buf = [0xf0]; this.inSysex = true; }
      else if (b === 0xf7 && this.inSysex) {
        this.buf.push(0xf7); out.push([...this.buf]); this.buf = []; this.inSysex = false;
      } else if (this.inSysex) { this.buf.push(b); }
    }
    return out;
  }
}

// ─── Colors ──────────────────────────────────────────────────────────────────

const B = '\x1b[1m', D = '\x1b[2m', R = '\x1b[0m';
const GREEN = '\x1b[32m', CYAN = '\x1b[36m', YELLOW = '\x1b[33m';
const RED = '\x1b[31m', MAGENTA = '\x1b[35m';

// ─── Main ────────────────────────────────────────────────────────────────────

const txR = new Reassembler();
const rxR = new Reassembler();

for (const line of lines) {
  // Match TX/RX hex lines
  const txm = line.match(/(\d{2}:\d{2}:\d{2}\.\d+)\s+TX:\s+([\da-f\s]+)/i);
  const rxm = line.match(/(\d{2}:\d{2}:\d{2}\.\d+)\s+RX:\s+([\da-f\s]+)/i);

  if (txm || rxm) {
    const [, time, hexStr] = txm || rxm;
    const isTx = !!txm;
    const raw = parseHexSpaced(hexStr);
    const midi = stripBleMidi(raw);
    const reassembler = isTx ? txR : rxR;
    const dir = isTx ? `${CYAN}TX→${R}` : `${YELLOW}←RX${R}`;

    const completed = reassembler.push(midi);
    for (const sysex of completed) {
      const roland = decodeRoland(sysex);
      if (roland) {
        const c = roland.cmdName === 'DT1' ? MAGENTA : CYAN;
        const cs = roland.csOk ? '' : ` ${RED}BAD CS (got ${sysex[sysex.length-2].toString(16)}, want ${rolandChecksum([...sysex.slice(8,12), ...sysex.slice(12,-2)]).toString(16)})${R}`;
        const name = roland.addrName ? ` ${D}(${roland.addrName})${R}` : '';
        console.log(`${D}${time}${R}  ${dir}  ${B}${c}${roland.cmdName}${R}  addr=[${roland.addrHex}]${name}  data=[${hex(roland.data)}]${roland.extra}${cs}`);
        continue;
      }
      const id = decodeMidiIdentity(sysex);
      if (id) { console.log(`${D}${time}${R}  ${dir}  ${B}${GREEN}${id}${R}`); continue; }
      console.log(`${D}${time}${R}  ${dir}  SysEx[${sysex.length}]: ${hex(sysex)}`);
    }
    continue;
  }

  // Pass through INFO/WARN lines with light formatting
  const im = line.match(/\[(INFO|WARN|ERROR)\]\s+(\d{2}:\d{2}:\d{2}\.\d+)\s+(.*)/);
  if (im) {
    const [, level, time, msg] = im;
    const color = level === 'WARN' ? YELLOW : level === 'ERROR' ? RED : D;
    console.log(`${D}${time}${R}  ${color}${msg}${R}`);
  }
}
