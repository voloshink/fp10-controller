/**
 * DebugLog
 *
 * Scrollable in-app log panel. Entries are prepended so the newest line is
 * always at the top. Tap "Clear" to reset.
 */

import React, { useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Colors, Spacing, Radius } from '../theme';

export interface LogEntry {
  id:    number;
  ts:    string;   // HH:MM:SS.mmm
  level: 'info' | 'warn' | 'error' | 'ble';
  msg:   string;
}

interface Props {
  entries: LogEntry[];
  onClear: () => void;
}

const LEVEL_COLOR: Record<LogEntry['level'], string> = {
  info:  Colors.textMuted,
  warn:  Colors.scanning,
  error: Colors.error,
  ble:   Colors.accent,
};

export function DebugLog({ entries, onClear }: Props) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>DEBUG LOG</Text>
        <TouchableOpacity onPress={onClear} style={styles.clearBtn}>
          <Text style={styles.clearText}>Clear</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator
        nestedScrollEnabled
      >
        {entries.length === 0 ? (
          <Text style={styles.empty}>No log entries yet.</Text>
        ) : (
          entries.map((e) => (
            <View key={e.id} style={styles.row}>
              <Text style={styles.ts}>{e.ts}</Text>
              <Text style={[styles.msg, { color: LEVEL_COLOR[e.level] }]}>
                {e.msg}
              </Text>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#0A0A10',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.cardBorder,
  },
  title: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textMuted,
    letterSpacing: 2,
  },
  clearBtn: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
  },
  clearText: {
    fontSize: 12,
    color: Colors.accent,
    fontWeight: '600',
  },
  scroll: {
    maxHeight: 220,
  },
  scrollContent: {
    padding: Spacing.sm,
    gap: 4,
  },
  empty: {
    fontSize: 12,
    color: Colors.textDim,
    textAlign: 'center',
    padding: Spacing.md,
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.sm,
    flexWrap: 'wrap',
  },
  ts: {
    fontSize: 11,
    color: Colors.textDim,
    fontVariant: ['tabular-nums'],
    flexShrink: 0,
  },
  msg: {
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
    flexWrap: 'wrap',
  },
});
