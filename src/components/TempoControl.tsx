/**
 * TempoControl
 *
 * • Large BPM number display
 * • Native slider (onValueChange → display only; onSlidingComplete → BLE write)
 * • ±1 / ±10 buttons with long-press repeat (120 ms interval)
 *
 * The parent separates "display update" from "BLE send" so that dragging the
 * slider is silky smooth without flooding the BLE characteristic.
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
  tempo:                number;
  disabled:             boolean;
  /** Update display only – no BLE write (slider drag). */
  onTempoChange:        (bpm: number) => void;
  /** Update display AND write to BLE (slider release, button press). */
  onTempoCommit:        (bpm: number) => void;
  metronomeOn:          boolean;
  onMetronomeToggle:    () => void;
}

// ─── Adjustment button spec ───────────────────────────────────────────────────

const ADJUSTMENTS: { delta: number; label: string }[] = [
  { delta: -10, label: '−10' },
  { delta:  -1, label: '−1'  },
  { delta:  +1, label: '+1'  },
  { delta: +10, label: '+10' },
];

const REPEAT_DELAY_MS    = 350;  // initial delay before repeat starts
const REPEAT_INTERVAL_MS = 100;  // interval once repeat is running

// ─── Component ────────────────────────────────────────────────────────────────

export function TempoControl({
  tempo,
  disabled,
  onTempoChange,
  onTempoCommit,
  metronomeOn,
  onMetronomeToggle,
}: Props) {
  const tempoRef    = useRef(tempo);
  tempoRef.current  = tempo;

  // Local slider value — decoupled from the parent prop to prevent the
  // bridge-latency snap-back that happens with controlled sliders on release.
  const [sliderTempo, setSliderTempo] = React.useState(tempo);
  const isDragging = useRef(false);

  // Sync prop → slider only when the thumb isn't being touched (e.g. ±1
  // button press or a BLE echo from the piano updating parent state).
  React.useEffect(() => {
    if (!isDragging.current) {
      setSliderTempo(tempo);
    }
  }, [tempo]);

  // For repeating presses
  const delayTimer    = useRef<ReturnType<typeof setTimeout>>();
  const repeatTimer   = useRef<ReturnType<typeof setInterval>>();

  const clamp = (v: number) => Math.max(20, Math.min(240, Math.round(v)));

  // ── Adjust helpers ─────────────────────────────────────────────────────────

  const applyDelta = useCallback(
    (delta: number) => {
      const next = clamp(tempoRef.current + delta);
      onTempoCommit(next); // updates display state AND sends BLE
    },
    [onTempoCommit],
  );

  const startRepeat = useCallback(
    (delta: number) => {
      applyDelta(delta); // immediate first press
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

  // Handlers for the press-and-hold gesture on each button
  const handlePressIn = useCallback(
    (delta: number) => (_e: GestureResponderEvent) => {
      if (!disabled) startRepeat(delta);
    },
    [disabled, startRepeat],
  );

  // ── Slider handlers ────────────────────────────────────────────────────────

  const handleSliderChange = useCallback(
    (val: number) => {
      isDragging.current = true;
      setSliderTempo(val);
      onTempoChange(val);
    },
    [onTempoChange],
  );

  const handleSliderComplete = useCallback(
    (val: number) => {
      isDragging.current = false;
      onTempoCommit(val);
    },
    [onTempoCommit],
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <View style={[styles.card, disabled && styles.disabled]}>

      {/* ── Header row: label + metronome toggle ── */}
      <View style={styles.headerRow}>
        <Text style={styles.label}>TEMPO</Text>
        <TouchableOpacity
          style={styles.metroToggle}
          onPress={disabled ? undefined : onMetronomeToggle}
          disabled={disabled}
          activeOpacity={0.75}
          accessibilityRole="switch"
          accessibilityState={{ checked: metronomeOn, disabled }}
        >
          <Text style={[styles.metroLabel, metronomeOn && styles.metroLabelOn]}>
            METRONOME
          </Text>
          <View style={[styles.pillTrack, metronomeOn ? styles.pillTrackOn : styles.pillTrackOff]}>
            <View style={[styles.pillKnob, metronomeOn ? styles.pillKnobOn : styles.pillKnobOff]} />
          </View>
        </TouchableOpacity>
      </View>

      {/* ── BPM number display ── */}
      <View style={styles.displayRow}>
        <Text
          style={[styles.bpmNumber, disabled && styles.dimText]}
          adjustsFontSizeToFit
          numberOfLines={1}
        >
          {tempo}
        </Text>
        <Text style={styles.bpmUnit}>BPM</Text>
      </View>

      {/* ── Slider ── */}
      <Slider
        style={styles.slider}
        minimumValue={20}
        maximumValue={240}
        step={10}
        value={sliderTempo}
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
        <Text style={styles.rangeLabel}>20</Text>
        <Text style={styles.rangeLabel}>240</Text>
      </View>

      {/* ── Fine-tune / coarse buttons ── */}
      <View style={styles.btnRow}>
        {ADJUSTMENTS.map(({ delta, label }) => (
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
        ))}
      </View>

      {/* ── Disabled overlay note ── */}
      {disabled && (
        <Text style={styles.disabledNote}>Connect to FP-10 to control tempo</Text>
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

  // header
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    ...Typography.sectionLabel,
  },

  // metronome toggle (top-right)
  metroToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  metroLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: Colors.textDim,
    textTransform: 'uppercase',
  },
  metroLabelOn: {
    color: Colors.toggleOnText,
  },
  pillTrack: {
    width: 44,
    height: 26,
    borderRadius: Radius.full,
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  pillTrackOn: {
    backgroundColor: Colors.toggleOnTrack,
  },
  pillTrackOff: {
    backgroundColor: Colors.toggleOffTrack,
  },
  pillKnob: {
    width: 20,
    height: 20,
    borderRadius: Radius.full,
  },
  pillKnobOn: {
    backgroundColor: Colors.toggleOnKnob,
    alignSelf: 'flex-end',
  },
  pillKnobOff: {
    backgroundColor: Colors.toggleOffKnob,
    alignSelf: 'flex-start',
  },

  // BPM display
  displayRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingTop: Spacing.xs,
  },
  bpmNumber: {
    ...Typography.bpmNumber,
  },
  bpmUnit: {
    ...Typography.bpmUnit,
    marginBottom: 14,
  },

  // slider
  slider: {
    width: '100%',
    height: 38,
    marginTop: Spacing.xs,
  },

  // range labels
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

  // adjustment buttons
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

  // disabled note
  disabledNote: {
    ...Typography.bodySmall,
    textAlign: 'center',
    marginTop: Spacing.xs,
  },
});
