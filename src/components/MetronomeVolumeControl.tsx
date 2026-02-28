/**
 * MetronomeVolumeControl
 *
 * Compact slider for metronome volume (1–10).
 * Slider drag → display only; slider release → BLE write.
 */

import React, { useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { Colors, Typography, Spacing, Radius } from '../theme';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  volume:         number;   // 1–10
  disabled:       boolean;
  onVolumeChange: (vol: number) => void;  // display-only (slider drag)
  onVolumeCommit: (vol: number) => void;  // display + BLE write
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MetronomeVolumeControl({
  volume,
  disabled,
  onVolumeChange,
  onVolumeCommit,
}: Props) {
  // Local slider value — decoupled from the parent prop to prevent the
  // bridge-latency snap-back that happens with controlled sliders on release.
  const [sliderVolume, setSliderVolume] = React.useState(volume);
  const isDragging = useRef(false);

  // Sync prop → slider only when the thumb isn't being touched.
  React.useEffect(() => {
    if (!isDragging.current) {
      setSliderVolume(volume);
    }
  }, [volume]);

  // ── Slider handlers ──────────────────────────────────────────────────────

  const handleSliderChange = useCallback(
    (val: number) => {
      isDragging.current = true;
      setSliderVolume(val);
      onVolumeChange(val);
    },
    [onVolumeChange],
  );

  const handleSliderComplete = useCallback(
    (val: number) => {
      isDragging.current = false;
      onVolumeCommit(val);
    },
    [onVolumeCommit],
  );

  return (
    <View style={[styles.card, disabled && styles.disabled]}>
      <View style={styles.headerRow}>
        <Text style={styles.label}>METRONOME VOLUME</Text>
        <Text style={[styles.volNumber, disabled && styles.dimText]}>{volume}</Text>
      </View>

      {/* ── Slider ── */}
      <Slider
        style={styles.slider}
        minimumValue={1}
        maximumValue={10}
        step={1}
        value={sliderVolume}
        onValueChange={disabled ? undefined : handleSliderChange}
        onSlidingComplete={disabled ? undefined : handleSliderComplete}
        minimumTrackTintColor={disabled ? Colors.toggleOffTrack : Colors.accent}
        maximumTrackTintColor={Colors.cardBorder}
        thumbTintColor={disabled ? Colors.toggleOffKnob : Colors.accent}
        disabled={disabled}
        tapToSeek
      />

      {/* ── Range labels ── */}
      <View style={styles.rangeRow}>
        <Text style={styles.rangeLabel}>1</Text>
        <Text style={styles.rangeLabel}>10</Text>
      </View>

      {disabled && (
        <Text style={styles.disabledNote}>Connect to FP-10 to adjust volume</Text>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  disabled: {
    opacity: 0.55,
  },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    ...Typography.sectionLabel,
  },
  volNumber: {
    fontSize: 28,
    fontWeight: '700',
    color: Colors.text,
    fontVariant: ['tabular-nums'],
  },
  dimText: {
    color: Colors.textMuted,
  },

  slider: {
    width: '100%',
    height: 38,
  },

  rangeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -Spacing.xs,
    paddingHorizontal: 4,
  },
  rangeLabel: {
    fontSize: 11,
    color: Colors.textDim,
    fontWeight: '500',
  },

  disabledNote: {
    ...Typography.bodySmall,
    textAlign: 'center',
    marginTop: Spacing.xs,
  },
});
