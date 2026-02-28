#!/usr/bin/env bash
#
# Parse a PacketLogger text export into decoded BLE-MIDI / Roland SysEx.
#
# Usage:
#   ./tools/parse-trace.sh /path/to/trace.txt
#   ./tools/parse-trace.sh /path/to/trace.txt --raw   # also show raw hex
#
# Filters to ATT Send/Receive lines, strips BLE-MIDI framing, reassembles
# multi-packet SysEx, and decodes Roland DT1/RQ1 messages.

set -euo pipefail

FILE="${1:?Usage: parse-trace.sh <trace.txt> [--raw]}"
RAW="${2:-}"

node "$(dirname "$0")/parse-trace.mjs" "$FILE" "$RAW"
