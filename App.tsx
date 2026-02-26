/**
 * FP-10 Controller
 *
 * Root component.  Owns no state itself — delegates entirely to useBleMidi.
 */

import React from 'react';
import {
  SafeAreaView,
  ScrollView,
  View,
  Text,
  StyleSheet,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { useBleMidi } from './src/hooks/useBleMidi';
import { ConnectionCard } from './src/components/ConnectionCard';
import { TempoControl }   from './src/components/TempoControl';
import { ToggleCard }     from './src/components/ToggleCard';
import { Colors, Typography, Spacing, Radius } from './src/theme';

// ─── Piano-key decorative strip ───────────────────────────────────────────────

const WHITE_KEY_COUNT = 14;
const BLACK_KEY_PATTERN = [1, 1, 0, 1, 1, 1, 0]; // 0 = gap (no black key)

function PianoKeys() {
  return (
    <View style={keys.row}>
      {Array.from({ length: WHITE_KEY_COUNT }).map((_, i) => {
        const hasBlack = BLACK_KEY_PATTERN[i % BLACK_KEY_PATTERN.length] === 1;
        return (
          <View key={i} style={keys.whiteKeyWrap}>
            <View style={keys.whiteKey} />
            {hasBlack && i < WHITE_KEY_COUNT - 1 && (
              <View style={keys.blackKey} />
            )}
          </View>
        );
      })}
    </View>
  );
}

const keys = StyleSheet.create({
  row: {
    flexDirection: 'row',
    height: 56,
    paddingHorizontal: 2,
    gap: 2,
    overflow: 'hidden',
  },
  whiteKeyWrap: {
    flex: 1,
    position: 'relative',
  },
  whiteKey: {
    flex: 1,
    backgroundColor: '#2A2A38',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#3A3A4E',
  },
  blackKey: {
    position: 'absolute',
    right: -5,
    top: 0,
    width: 10,
    height: 34,
    backgroundColor: '#0D0D14',
    borderRadius: 3,
    borderWidth: 1,
    borderColor: '#1A1A28',
    zIndex: 1,
  },
});

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function App() {
  const midi = useBleMidi();

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          <View>
            <Text style={styles.appTitle}>FP-10 Controller</Text>
            <Text style={styles.appSubtitle}>Roland Digital Piano</Text>
          </View>
          <View style={styles.pianoIcon}>
            <Text style={styles.pianoEmoji}>🎹</Text>
          </View>
        </View>

        {/* ── Piano-key strip ── */}
        <View style={styles.keysCard}>
          <PianoKeys />
        </View>

        {/* ── Connection ── */}
        <ConnectionCard
          status={midi.status}
          statusMessage={midi.statusMessage}
          onConnect={midi.connect}
          onDisconnect={midi.disconnect}
        />

        {/* ── Tempo ── */}
        <TempoControl
          tempo={midi.tempo}
          disabled={!midi.isConnected}
          onTempoChange={midi.setTempoLocal}
          onTempoCommit={midi.sendTempo}
        />

        {/* ── Metronome toggle ── */}
        <ToggleCard
          label="METRONOME"
          description="State is mirrored locally — first tap may desync if the piano's metronome was already on."
          value={midi.metronomeOn}
          onToggle={midi.toggleMetronome}
          disabled={!midi.isConnected}
        />

        {/* ── Downbeat toggle ── */}
        <ToggleCard
          label="DOWNBEAT"
          description="Accent on beat 1 (direct on/off command)"
          value={midi.downbeatOn}
          onToggle={() => midi.setDownbeatOn(!midi.downbeatOn)}
          disabled={!midi.isConnected}
        />

        {/* ── Footer ── */}
        <Text style={styles.footer}>
          BLE MIDI · SysEx DT1 · Roland FP-10
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: Spacing.md,
    gap: Spacing.md,
    paddingBottom: 48,
  },

  // header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
  },
  appTitle: {
    ...Typography.appTitle,
  },
  appSubtitle: {
    ...Typography.appSubtitle,
    marginTop: 3,
  },
  pianoIcon: {
    width: 56,
    height: 56,
    borderRadius: Radius.lg,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pianoEmoji: {
    fontSize: 30,
  },

  // piano key strip card
  keysCard: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    overflow: 'hidden',
    padding: Spacing.sm,
  },

  // footer
  footer: {
    textAlign: 'center',
    fontSize: 11,
    color: Colors.textDim,
    letterSpacing: 1.5,
    marginTop: Spacing.sm,
  },
});
