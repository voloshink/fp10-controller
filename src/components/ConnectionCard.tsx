import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  StyleSheet,
} from 'react-native';
import { ConnectionStatus } from '../ble/BleMidiManager';
import { Colors, Typography, Spacing, Radius } from '../theme';

// ─── Metadata maps ────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<ConnectionStatus, string> = {
  idle:       Colors.textMuted,
  scanning:   Colors.scanning,
  connecting: Colors.scanning,
  connected:  Colors.connected,
  error:      Colors.error,
};

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  idle:       'Not connected',
  scanning:   'Scanning…',
  connecting: 'Connecting…',
  connected:  'Connected',
  error:      'Connection failed',
};

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  status:             ConnectionStatus;
  statusMessage:      string;
  connectionProgress: number;   // 0–1
  onConnect:          () => void;
  onDisconnect:       () => void;
}

export function ConnectionCard({
  status,
  statusMessage,
  connectionProgress,
  onConnect,
  onDisconnect,
}: Props) {
  const isBusy      = status === 'scanning' || status === 'connecting';
  const isConnected = status === 'connected';
  const statusColor = STATUS_COLOR[status];

  // ── Animated progress bar ──────────────────────────────────────────────────

  const progressAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: connectionProgress,
      duration: 450,
      useNativeDriver: false,
    }).start();
  }, [connectionProgress]);

  // Pulse opacity while actively waiting (scanning phase, before first step)
  const pulseAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (isBusy) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.45, duration: 900, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1,    duration: 900, useNativeDriver: true }),
        ]),
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isBusy]);

  const barWidth = progressAnim.interpolate({
    inputRange:  [0, 1],
    outputRange: ['0%', '100%'],
    extrapolate: 'clamp',
  });

  const barColor = status === 'connected' ? Colors.connected : Colors.scanning;

  return (
    <View style={styles.card}>
      {/* ── Header row: dot + label ── */}
      <View style={styles.headerRow}>
        <View style={[styles.dot, { backgroundColor: statusColor }]} />
        <Text style={[styles.statusLabel, { color: statusColor }]}>
          {STATUS_LABEL[status]}
        </Text>
      </View>

      {/* ── Progress bar (visible while busy or just connected) ── */}
      {(isBusy || isConnected) && (
        <View style={styles.progressTrack}>
          <Animated.View
            style={[
              styles.progressFill,
              { width: barWidth, backgroundColor: barColor },
            ]}
          />
          {/* Shimmer overlay while actively working */}
          {isBusy && (
            <Animated.View
              style={[styles.progressShimmer, { opacity: pulseAnim }]}
            />
          )}
        </View>
      )}

      {/* ── Step label ── */}
      {statusMessage !== '' && (isBusy || isConnected) && (
        <Text style={styles.stepLabel}>{statusMessage}</Text>
      )}

      {/* ── Error message ── */}
      {status === 'error' && statusMessage !== '' && (
        <Text style={styles.errorMessage}>{statusMessage}</Text>
      )}

      {/* ── Action button ── */}
      {isConnected ? (
        <TouchableOpacity
          style={styles.disconnectBtn}
          onPress={onDisconnect}
          activeOpacity={0.75}
        >
          <Text style={styles.disconnectText}>Disconnect</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={[styles.connectBtn, isBusy && styles.connectBtnBusy]}
          onPress={isBusy ? undefined : onConnect}
          disabled={isBusy}
          activeOpacity={0.8}
        >
          <Text style={[styles.connectText, isBusy && styles.connectTextBusy]}>
            {status === 'error' ? 'Retry Connection' : isBusy ? 'Please wait…' : 'Connect to FP-10'}
          </Text>
        </TouchableOpacity>
      )}

      {/* ── Scanning hint ── */}
      {status === 'scanning' && (
        <Text style={styles.hint}>
          Make sure the FP-10 is powered on and Bluetooth is enabled.
        </Text>
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

  // status row
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: Radius.full,
  },
  statusLabel: {
    ...Typography.statusText,
  },

  // progress bar
  progressTrack: {
    height: 4,
    borderRadius: Radius.full,
    backgroundColor: Colors.cardBorder,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: Radius.full,
  },
  progressShimmer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#FFFFFF22',
    borderRadius: Radius.full,
  },

  // step label beneath the bar
  stepLabel: {
    ...Typography.bodySmall,
    color: Colors.textMuted,
    marginTop: -Spacing.xs,
  },

  // error message
  errorMessage: {
    ...Typography.bodySmall,
    color: Colors.error,
  },

  // connect button
  connectBtn: {
    backgroundColor: Colors.btnPrimary,
    borderRadius: Radius.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  connectBtnBusy: {
    backgroundColor: Colors.btnDisabled,
  },
  connectText: {
    ...Typography.btnLabel,
    color: Colors.btnPrimaryText,
  },
  connectTextBusy: {
    color: Colors.btnDisabledText,
  },

  // disconnect button
  disconnectBtn: {
    backgroundColor: Colors.btnDanger,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.btnDangerBorder,
    paddingVertical: 14,
    alignItems: 'center',
  },
  disconnectText: {
    ...Typography.btnLabel,
    color: Colors.btnDangerText,
  },

  // scanning hint
  hint: {
    ...Typography.bodySmall,
    color: Colors.textMuted,
    textAlign: 'center',
  },
});
