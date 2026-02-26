import { useState, useCallback } from 'react';
import { LogEntry } from '../components/DebugLog';

let seq = 0;

function timestamp(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

export function useLogger() {
  const [entries, setEntries] = useState<LogEntry[]>([]);

  const log = useCallback((level: LogEntry['level'], msg: string) => {
    const entry: LogEntry = { id: seq++, ts: timestamp(), level, msg };
    console.log(`[${level.toUpperCase()}] ${entry.ts} ${msg}`);
    setEntries((prev) => [entry, ...prev].slice(0, 200)); // cap at 200 lines
  }, []);

  const clear = useCallback(() => setEntries([]), []);

  return { entries, log, clear };
}
