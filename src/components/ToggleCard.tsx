/**
 * ToggleCard
 *
 * A full-width tappable card that switches between ON and OFF states.
 * Designed to look like an illuminated console button:
 *   ON  → green tinted border + background, glowing label
 *   OFF → dark, muted styling
 */

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Colors, Typography, Spacing, Radius } from '../theme';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  /** Section heading shown above the toggle area. */
  label:       string;
  /** Small explanatory line shown beneath the heading. */
  description?: string;
  /** Current state. */
  value:       boolean;
  /** Called when the user taps. No argument — parent owns state transitions. */
  onToggle:    () => void;
  /** When true the card is visually dimmed and interaction is blocked. */
  disabled:    boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ToggleCard({
  label,
  description,
  value,
  onToggle,
  disabled,
}: Props) {
  return (
    <View style={[styles.card, disabled && styles.cardDisabled]}>

      {/* ── Heading row ── */}
      <View style={styles.headingRow}>
        <View style={styles.headingText}>
          <Text style={styles.label}>{label}</Text>
          {description != null && (
            <Text style={styles.description}>{description}</Text>
          )}
        </View>

        {/* Inline pill-switch */}
        <TouchableOpacity
          style={[styles.pillTrack, value ? styles.pillTrackOn : styles.pillTrackOff]}
          onPress={disabled ? undefined : onToggle}
          disabled={disabled}
          activeOpacity={0.85}
          accessibilityRole="switch"
          accessibilityState={{ checked: value, disabled }}
        >
          <View style={[styles.pillKnob, value ? styles.pillKnobOn : styles.pillKnobOff]} />
        </TouchableOpacity>
      </View>

      {/* ── Big tap button ── */}
      <TouchableOpacity
        style={[styles.button, value ? styles.buttonOn : styles.buttonOff]}
        onPress={disabled ? undefined : onToggle}
        disabled={disabled}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={`${label} is ${value ? 'on' : 'off'}. Tap to ${value ? 'turn off' : 'turn on'}.`}
      >
        {/* Indicator dot */}
        <View style={[styles.indicator, value ? styles.indicatorOn : styles.indicatorOff]} />
        <Text style={[styles.buttonText, value ? styles.buttonTextOn : styles.buttonTextOff]}>
          {value ? 'ON' : 'OFF'}
        </Text>
      </TouchableOpacity>

      {disabled && (
        <Text style={styles.disabledNote}>Connect to FP-10 to control</Text>
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
    gap: Spacing.md,
  },
  cardDisabled: {
    opacity: 0.5,
  },

  // heading
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headingText: {
    flex: 1,
    gap: 3,
  },
  label: {
    ...Typography.sectionLabel,
  },
  description: {
    ...Typography.bodySmall,
  },

  // pill switch
  pillTrack: {
    width: 52,
    height: 30,
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
    width: 24,
    height: 24,
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

  // big button
  button: {
    borderRadius: Radius.md,
    borderWidth: 1.5,
    paddingVertical: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  buttonOn: {
    backgroundColor: Colors.toggleOnBg,
    borderColor: Colors.toggleOnBorder,
    // shadow — green glow
    shadowColor: Colors.connected,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 4,
  },
  buttonOff: {
    backgroundColor: Colors.toggleOffBg,
    borderColor: Colors.toggleOffBorder,
  },

  // indicator dot inside button
  indicator: {
    width: 9,
    height: 9,
    borderRadius: Radius.full,
  },
  indicatorOn: {
    backgroundColor: Colors.toggleOnText,
    // glow
    shadowColor: Colors.connected,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 4,
  },
  indicatorOff: {
    backgroundColor: Colors.toggleOffText,
  },

  // button text
  buttonText: {
    ...Typography.toggleLabel,
    letterSpacing: 3,
  },
  buttonTextOn: {
    color: Colors.toggleOnText,
  },
  buttonTextOff: {
    color: Colors.toggleOffText,
  },

  disabledNote: {
    ...Typography.bodySmall,
    textAlign: 'center',
  },
});
