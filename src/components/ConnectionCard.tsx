import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
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
  status:        ConnectionStatus;
  statusMessage: string;
  onConnect:     () => void;
  onDisconnect:  () => void;
}

export function ConnectionCard({
  status,
  statusMessage,
  onConnect,
  onDisconnect,
}: Props) {
  const isBusy      = status === 'scanning' || status === 'connecting';
  const isConnected = status === 'connected';
  const statusColor = STATUS_COLOR[status];

  return (
    <View style={styles.card}>
      {/* ── Header row: dot + label ── */}
      <View style={styles.headerRow}>
        <View style={styles.statusDotWrap}>
          {isBusy ? (
            <ActivityIndicator color={statusColor} size="small" />
          ) : (
            <View style={[styles.dot, { backgroundColor: statusColor }]} />
          )}
        </View>
        <Text style={[styles.statusLabel, { color: statusColor }]}>
          {STATUS_LABEL[status]}
        </Text>
      </View>

      {/* ── Detail message ── */}
      {statusMessage !== '' && (
        <Text style={styles.message}>{statusMessage}</Text>
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
  statusDotWrap: {
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: Radius.full,
  },
  statusLabel: {
    ...Typography.statusText,
  },

  // message
  message: {
    ...Typography.bodySmall,
    marginLeft: 28,  // align with status label
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
