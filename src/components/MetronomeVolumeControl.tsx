/**
 * MetronomeVolumeControl
 *
 * Slider + ±1 buttons for metronome volume (1–10).
 * Same drag/commit split as TempoControl: slider drag → display only,
 * slider release / button press → BLE write.
 */

import React, { useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  GestureResponderEvent,
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

const REPEAT_DELAY_MS    = 350;
const REPEAT_INTERVAL_MS = 100;

export function MetronomeVolumeControl({
  volume,
  disabled,
  onVolumeChange,
  onVolumeCommit,
}: Props) {
  const volumeRef   = useRef(volume);
  volumeRef.current = volume;

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

  const delayTimer  = useRef<ReturnType<typeof setTimeout>>();
  const repeatTimer = useRef<ReturnType<typeof setInterval>>();

  const clamp = (v: number) => Math.max(1, Math.min(10, Math.round(v)));

  const applyDelta = useCallback(
    (delta: number) => {
      onVolumeCommit(clamp(volumeRef.current + delta));
    },
    [onVolumeCommit],
  );

  const startRepeat = useCallback(
    (delta: number) => {
      applyDelta(delta);
      delayTimer.current = setTimeout(() => {
        repeatTimer.current = setInterval(() => applyDelta(delta), REPEAT_INTERVAL_MS);
      }, REPEAT_DELAY_MS);
    },
    [applyDelta],
  );

  const stopRepeat = useCallback(() => {
    clearTimeout(delayTimer.current);
    clearInterval(repeatTimer.current);
  }, []);

  const handlePressIn = useCallback(
    (delta: number) => (_e: GestureResponderEvent) => {
      if (!disabled) startRepeat(delta);
    },
    [disabled, startRepeat],
  );

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
      <Text style={styles.label}>METRONOME VOLUME</Text>

      {/* ── Value display ── */}
      <View style={styles.displayRow}>
        <Text style={[styles.volNumber, disabled && styles.dimText]}>
          {volume}
        </Text>
        <Text style={styles.volUnit}>/ 10</Text>
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

      {/* ── ±1 buttons ── */}
      <View style={styles.btnRow}>
        {([{ delta: -1, label: '−1' }, { delta: +1, label: '+1' }] as const).map(
          ({ delta, label }) => (
            <TouchableOpacity
              key={delta}
              style={[styles.adjBtn, disabled && styles.adjBtnDisabled]}
              onPressIn={handlePressIn(delta)}
              onPressOut={stopRepeat}
              disabled={disabled}
              activeOpacity={0.7}
            >
              <Text style={[styles.adjBtnText, disabled && styles.dimText]}>
                {label}
              </Text>
            </TouchableOpacity>
          ),
        )}
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

  label: {
    ...Typography.sectionLabel,
  },

  displayRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
    paddingTop: Spacing.xs,
  },
  volNumber: {
    fontSize: 64,
    fontWeight: '800',
    color: Colors.text,
    fontVariant: ['tabular-nums'],
    lineHeight: 72,
  },
  volUnit: {
    fontSize: 20,
    fontWeight: '500',
    color: Colors.textDim,
    marginBottom: 10,
  },

  slider: {
    width: '100%',
    height: 38,
    marginTop: Spacing.xs,
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

  btnRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  adjBtn: {
    flex: 1,
    backgroundColor: Colors.toggleOffBg,
    borderRadius: Radius.md,
    paddingVertical: 13,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  adjBtnDisabled: {
    opacity: 0.5,
  },
  adjBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.text,
    letterSpacing: 0.5,
  },
  dimText: {
    color: Colors.textMuted,
  },

  disabledNote: {
    ...Typography.bodySmall,
    textAlign: 'center',
    marginTop: Spacing.xs,
  },
});
