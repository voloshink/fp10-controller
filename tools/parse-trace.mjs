#!/usr/bin/env node
/**
 * PacketLogger trace parser for BLE-MIDI / Roland SysEx.
 *
 * Reads a PacketLogger text export, extracts ATT-level BLE-MIDI traffic,
 * strips BLE-MIDI framing, reassembles multi-packet SysEx, and decodes
 * Roland DT1/RQ1 messages into human-readable output.
 *
 * Usage:
 *   node tools/parse-trace.mjs trace.txt [--raw]
 */

import { readFileSync } from 'fs';

const file = process.argv[2];
const showRaw = process.argv.includes('--raw');
if (!file) { console.error('Usage: parse-trace.mjs <trace.txt> [--raw]'); process.exit(1); }

const lines = readFileSync(file, 'utf-8').split('\n');

// ─── Hex helpers ─────────────────────────────────────────────────────────────

function parseHex(s) {
  // "8BDF F041 1000 0000 2811 0100 0700 0000…" → [0x8B, 0xDF, ...]
  return [...s.replace(/…/g, '').replace(/\s+/g, '')]
    .reduce((acc, ch, i, arr) => {
      if (i % 2 === 0 && i + 1 < arr.length) acc.push(parseInt(arr[i] + arr[i + 1], 16));
      return acc;
    }, [])
    .filter(b => !isNaN(b));
}

function hex(bytes) {
  return bytes.map(b => b.toString(16).padStart(2, '0')).join(' ');
}

// ─── BLE-MIDI framing ───────────────────────────────────────────────────────

/**
 * Strip BLE-MIDI framing from a raw ATT value.
 *
 * Stateless — just removes the header byte (byte 0) and any timestamp bytes
 * that appear immediately before F0 or F7.  All other bytes (including
 * data bytes with bit7=1, e.g. BPM > 127) pass through.
 *
 * The SysExReassembler handles F0/F7 framing across multiple packets.
 */
function stripBleMidi(raw) {
  const out = [];
  if (raw.length < 1) return out;

  for (let i = 1; i < raw.length; i++) { // skip byte 0 (header)
    const b = raw[i];
    const next = raw[i + 1];

    // Skip timestamp bytes: bit7=1 immediately before F0 or F7
    if ((b & 0x80) && (next === 0xf0 || next === 0xf7)) continue;

    out.push(b);
  }
  return out;
}

// ─── Roland SysEx decoder ────────────────────────────────────────────────────

function rolandChecksum(bytes) {
  const sum = bytes.reduce((a, b) => a + b, 0);
  return (128 - (sum % 128)) % 128;
}

const ROLAND_ADDRS = {
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
  if (sysex.length < 14) return null;
  if (sysex[1] !== 0x41) return null; // Not Roland

  const devId = sysex[2];
  const modelId = hex(sysex.slice(3, 7));
  const cmd = sysex[7];
  const cmdName = cmd === 0x11 ? 'RQ1' : cmd === 0x12 ? 'DT1' : `CMD:${cmd.toString(16)}`;

  const addr = sysex.slice(8, 12);
  const addrHex = hex(addr);
  const addrName = ROLAND_ADDRS[addrHex] ?? '';

  // Data = everything between addr and checksum+F7
  const data = sysex.slice(12, sysex.length - 2);
  const checksum = sysex[sysex.length - 2];
  const expectedCs = rolandChecksum([...addr, ...data]);
  const csOk = checksum === expectedCs;

  let decoded = '';
  // Try to decode common values
  if (cmdName === 'DT1' && addrHex === '01 00 03 09' && data.length >= 1) {
    // Tempo: 1 byte = BPM, or 2 bytes = high*128 + low
    const bpm = data.length === 2 ? data[0] * 128 + data[1] : data[0];
    decoded = `  → BPM ${bpm}`;
  } else if (cmdName === 'DT1' && addrHex === '01 00 05 09' && data.length === 1) {
    decoded = data[0] === 0x00 ? '  → OFF' : data[0] === 0x01 ? '  → ON' : `  → toggle(0x${data[0].toString(16)})`;
  } else if (cmdName === 'RQ1' && data.length === 4) {
    const size = (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3];
    decoded = `  → size=${size}`;
  } else if (addrHex === '01 00 07 00' && data.length > 4) {
    // System info block — first 4 bytes might be date/version
    decoded = `  → info=[${hex(data)}]`;
  }

  // For DT1 data that looks like ASCII text, decode it
  if (data.length > 4 && data.every(b => b >= 0x20 && b < 0x7f)) {
    decoded += `  "${String.fromCharCode(...data)}"`;
  }

  return {
    cmdName,
    addrHex,
    addrName,
    data,
    checksum,
    csOk,
    decoded,
    devId,
  };
}

function decodeMidiIdentity(sysex) {
  // Identity Request: F0 7E <ch> 06 01 F7
  // Identity Reply:   F0 7E <ch> 06 02 <manufacturer> <family:2> <model:2> <version:4> F7
  if (sysex.length < 5 || sysex[1] !== 0x7e) return null;
  const ch = sysex[2];
  const sub1 = sysex[3];
  const sub2 = sysex[4];
  if (sub1 === 0x06 && sub2 === 0x01) {
    return `Identity Request (ch=${ch === 0x7f ? 'broadcast' : ch})`;
  }
  if (sub1 === 0x06 && sub2 === 0x02 && sysex.length >= 15) {
    const mfr = sysex[5] === 0x00 ? hex(sysex.slice(5, 8)) : sysex[5].toString(16);
    const family = hex(sysex.slice(8, 10));
    const model = hex(sysex.slice(10, 12));
    const ver = hex(sysex.slice(12, sysex.length - 1));
    return `Identity Reply (ch=${ch}) mfr=${mfr} family=${family} model=${model} ver=${ver}`;
  }
  return `Universal SysEx ch=${ch} sub=[${hex(sysex.slice(3, sysex.length - 1))}]`;
}

// ─── SysEx reassembler (across multiple ATT packets) ─────────────────────────

class SysExReassembler {
  constructor() { this.buf = []; this.inSysex = false; }

  push(midiBytes) {
    const complete = [];
    for (const b of midiBytes) {
      if (b === 0xf0) {
        this.buf = [0xf0];
        this.inSysex = true;
      } else if (b === 0xf7 && this.inSysex) {
        this.buf.push(0xf7);
        complete.push([...this.buf]);
        this.buf = [];
        this.inSysex = false;
      } else if (this.inSysex) {
        this.buf.push(b);
      }
    }
    return complete;
  }
}

// ─── Main parsing ────────────────────────────────────────────────────────────

const re = /^(\w+ \d+ [\d:.]+)\s+(ATT \w+|Config)\s+0x[\dA-Fa-f]+\s+\S+\s+(.*)/;

/**
 * Extract ATT value from raw data bytes (the hex after double-space in Raw Data exports).
 * Raw format: [conn_handle:2] [hci_len:2] [l2cap_len:2] [l2cap_cid:2] [att_opcode:1] [handle:2?] [value...]
 *
 * ATT opcodes with a handle field (value starts at byte 11):
 *   0x12 Write Request, 0x52 Write Command, 0x1B Handle Value Notification
 *
 * ATT opcodes without handle (value starts at byte 9):
 *   0x0B Read Response
 */
function extractValueFromRaw(rawHex) {
  const bytes = rawHex.trim().split(/\s+/).map(h => parseInt(h, 16)).filter(b => !isNaN(b));
  if (bytes.length < 9) return null;
  const opcode = bytes[8];
  const hasHandle = [0x12, 0x52, 0x1b].includes(opcode);
  const offset = hasHandle ? 11 : 9;
  if (offset >= bytes.length) return null;
  return bytes.slice(offset);
}

const txReassembler = new SysExReassembler();
const rxReassembler = new SysExReassembler();

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const MAGENTA = '\x1b[35m';
const RESET = '\x1b[0m';

for (const line of lines) {
  const m = line.match(re);
  if (!m) continue;

  const [, time, type, detail] = m;
  const shortTime = time.replace(/^\w+ \d+ /, '');

  // Config lines
  if (type === 'Config') {
    console.log(`${DIM}${shortTime}${RESET}  ${BOLD}${GREEN}CONFIG${RESET}  ${detail.trim()}`);
    continue;
  }

  // Skip HCI events
  if (detail.includes('Number Of Completed Packets')) continue;

  const isSend = type === 'ATT Send';
  const dir = isSend ? `${CYAN}TX→${RESET}` : `${YELLOW}←RX${RESET}`;

  // Read Request/Response
  if (detail.includes('Read Request')) {
    const hm = detail.match(/Handle:(0x[\dA-Fa-f]+)/);
    console.log(`${DIM}${shortTime}${RESET}  ${dir}  Read Request  handle=${hm?.[1] ?? '?'}`);
    continue;
  }
  if (detail.includes('Read Response')) {
    const vm = detail.match(/Value:\s*([\dA-Fa-f\s…]+)/);
    const rawHex = vm?.[1]?.trim() ?? '';
    // Check for raw data bytes (Raw Data export)
    const rawDataMatch = detail.match(/…\s{2,}([\dA-Fa-f\s]+)$/) || detail.match(/F7\s{2,}([\dA-Fa-f\s]+)$/);
    let raw;
    if (rawDataMatch) {
      const fullValue = extractValueFromRaw(rawDataMatch[1]);
      raw = fullValue ?? parseHex(rawHex);
    } else {
      raw = parseHex(rawHex);
    }
    const midi = stripBleMidi(raw);
    if (midi.length > 0) {
      console.log(`${DIM}${shortTime}${RESET}  ${dir}  Read Response  midi=[${hex(midi)}]`);
    } else {
      console.log(`${DIM}${shortTime}${RESET}  ${dir}  Read Response  raw=[${rawHex}]`);
    }
    continue;
  }

  // Write Request (CCCD etc)
  if (detail.includes('Write Request')) {
    const hm = detail.match(/Handle:(0x[\dA-Fa-f]+)/);
    const vm = detail.match(/Value:\s*([\dA-Fa-f]+)/);
    const handle = hm?.[1] ?? '?';
    const val = vm?.[1]?.trim() ?? '';
    if (handle === '0x0011' && val === '0100') {
      console.log(`${DIM}${shortTime}${RESET}  ${dir}  ${BOLD}CCCD Enable Notifications${RESET}  handle=${handle}`);
    } else if (handle === '0x0011' && val === '0000') {
      console.log(`${DIM}${shortTime}${RESET}  ${dir}  ${DIM}CCCD Disable Notifications${RESET}  handle=${handle}`);
    } else {
      console.log(`${DIM}${shortTime}${RESET}  ${dir}  Write Request  handle=${handle} val=[${val}]`);
    }
    continue;
  }
  if (detail.includes('Write Response')) {
    console.log(`${DIM}${shortTime}${RESET}  ${dir}  Write Response (ACK)`);
    continue;
  }

  // Write Command or Notification — these carry BLE-MIDI data
  //
  // Raw Data export format has the full packet after a double-space:
  //   Value: 8099 F041…  58 00 1A 00 16 00 04 00 52 10 00 80 99 F0 41 ...
  //          ^^^^^^^^^^  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  //          text (trunc)         raw L2CAP/ATT bytes (full)

  // Split on double-space to separate text value from raw data
  const parts = detail.split(/\s{2,}/);
  const valuePart = parts.find(p => p.includes('Value:'));
  if (!valuePart) continue;

  const textHex = valuePart.replace(/^.*Value:\s*/, '').trim();
  let truncated = textHex.includes('…');

  // Look for raw data hex (the part AFTER the text display, separated by double-space)
  // Raw Data export includes full L2CAP/ATT bytes — extract just the ATT value
  const valueIdx = parts.indexOf(valuePart);
  const rawDataPart = parts.find((p, i) => i > valueIdx && /^[\dA-Fa-f]{2}\s/.test(p));
  let raw;
  if (rawDataPart) {
    const fullValue = extractValueFromRaw(rawDataPart);
    if (fullValue) {
      raw = fullValue;
      truncated = false; // full data recovered from raw bytes
    } else {
      raw = parseHex(textHex);
    }
  } else {
    raw = parseHex(textHex);
  }

  if (showRaw) {
    console.log(`${DIM}${shortTime}${RESET}  ${dir}  ${DIM}raw[${raw.length}${truncated ? '+' : ''}]: ${hex(raw)}${truncated ? '…' : ''}${RESET}`);
  }

  const midi = stripBleMidi(raw);
  const reassembler = isSend ? txReassembler : rxReassembler;

  // If the packet was truncated ("…"), mark partial data in reassembler
  if (truncated) reassembler.truncated = true;
  const completed = reassembler.push(midi);

  // If a completed SysEx used truncated data, flag it
  const wasTruncated = reassembler.truncated;
  if (completed.length > 0) reassembler.truncated = false;

  for (const sysex of completed) {
    const truncFlag = wasTruncated ? ` ${YELLOW}(truncated)${RESET}` : '';

    // Try Roland decode
    const roland = decodeRoland(sysex);
    if (roland) {
      const color = roland.cmdName === 'DT1' ? MAGENTA : CYAN;
      const csFlag = roland.csOk ? '' : (wasTruncated ? '' : ` ${RED}BAD CHECKSUM${RESET}`);
      const name = roland.addrName ? ` ${DIM}(${roland.addrName})${RESET}` : '';
      console.log(
        `${DIM}${shortTime}${RESET}  ${dir}  ${BOLD}${color}${roland.cmdName}${RESET}` +
        `  addr=[${roland.addrHex}]${name}` +
        `  data=[${hex(roland.data)}]` +
        `${roland.decoded}${csFlag}${truncFlag}`
      );
      continue;
    }

    // Try MIDI Identity
    const identity = decodeMidiIdentity(sysex);
    if (identity) {
      console.log(`${DIM}${shortTime}${RESET}  ${dir}  ${BOLD}${GREEN}${identity}${RESET}${truncFlag}`);
      continue;
    }

    // Unknown SysEx
    console.log(`${DIM}${shortTime}${RESET}  ${dir}  SysEx[${sysex.length}]: ${hex(sysex)}${truncFlag}`);
  }
}
