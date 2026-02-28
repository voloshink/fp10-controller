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
import { useLogger }  from './src/hooks/useLogger';
import { ConnectionCard }          from './src/components/ConnectionCard';
import { TempoControl }            from './src/components/TempoControl';
import { PianoVolumeControl }      from './src/components/PianoVolumeControl';
import { MetronomeVolumeControl }  from './src/components/MetronomeVolumeControl';
import { DebugLog }                from './src/components/DebugLog';
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
  const midi   = useBleMidi();
  const logger = useLogger();

  // Wire the logger into the BLE manager once on mount
  React.useEffect(() => {
    midi.setLogFn(logger.log);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

        {/* ── Connection ── */}
        <ConnectionCard
          status={midi.status}
          statusMessage={midi.statusMessage}
          connectionProgress={midi.connectionProgress}
          onConnect={midi.connect}
          onDisconnect={midi.disconnect}
        />

        {/* ── Piano volume ── */}
        <PianoVolumeControl
          volume={midi.pianoVolume}
          disabled={!midi.isConnected}
          onVolumeChange={midi.setPianoVolLocal}
          onVolumeCommit={midi.sendPianoVolume}
        />

        {/* ── Metronome section ── */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>⏱ Metronome</Text>

          <View style={styles.sectionCards}>
            {/* ── Tempo + metronome toggle ── */}
            <TempoControl
              tempo={midi.tempo}
              disabled={!midi.isConnected}
              onTempoChange={midi.setTempoLocal}
              onTempoCommit={midi.sendTempo}
              metronomeOn={midi.metronomeOn}
              onMetronomeToggle={midi.toggleMetronome}
            />

            {/* ── Metronome volume ── */}
            <MetronomeVolumeControl
              volume={midi.metronomeVolume}
              disabled={!midi.isConnected}
              onVolumeChange={midi.setMetronomeVolLocal}
              onVolumeCommit={midi.sendMetronomeVolume}
            />
          </View>
        </View>

        {/* ── Piano-key strip ── */}
        <View style={styles.keysCard}>
          <PianoKeys />
        </View>

        {/* ── Debug log ── */}
        <DebugLog entries={logger.entries} onClear={logger.clear} />

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

  // metronome section group
  section: {
    gap: Spacing.xs,
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textMuted,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    paddingHorizontal: Spacing.xs,
  },
  sectionCards: {
    gap: Spacing.md,
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    padding: Spacing.md,
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
