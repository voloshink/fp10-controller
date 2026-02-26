// ─── Colour palette ──────────────────────────────────────────────────────────
export const Colors = {
  // backgrounds
  bg: '#0D0D10',
  card: '#18181F',
  cardBorder: '#2C2C3A',
  cardBorderActive: '#4A4A62',

  // brand / accent
  accent: '#C8A86B',       // warm brass – piano hardware gold
  accentDim: '#7A6438',

  // semantic states
  connected: '#22C55E',
  connectedBg: '#052E12',
  scanning: '#F59E0B',
  scanningBg: '#2D1E03',
  error: '#EF4444',
  errorBg: '#2D0808',

  // toggle — ON
  toggleOnText: '#22C55E',
  toggleOnBg: '#071C0E',
  toggleOnBorder: '#22C55E',
  toggleOnKnob: '#22C55E',
  toggleOnTrack: '#145228',

  // toggle — OFF
  toggleOffText: '#666680',
  toggleOffBg: '#18181F',
  toggleOffBorder: '#2C2C3A',
  toggleOffKnob: '#444458',
  toggleOffTrack: '#2C2C3A',

  // buttons
  btnPrimary: '#2563EB',
  btnPrimaryText: '#FFFFFF',
  btnDanger: '#1A0606',
  btnDangerBorder: '#7F1D1D',
  btnDangerText: '#EF4444',
  btnDisabled: '#1E1E28',
  btnDisabledText: '#444455',

  // text
  text: '#F0F0F6',
  textMuted: '#666680',
  textDim: '#3A3A50',
} as const;

// ─── Typography ───────────────────────────────────────────────────────────────
export const Typography = {
  appTitle: {
    fontSize: 24,
    fontWeight: '800' as const,
    color: Colors.text,
    letterSpacing: -0.5,
  },
  appSubtitle: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.accent,
    letterSpacing: 2,
    textTransform: 'uppercase' as const,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: Colors.textMuted,
    letterSpacing: 2,
    textTransform: 'uppercase' as const,
  },
  bpmNumber: {
    fontSize: 88,
    fontWeight: '800' as const,
    color: Colors.text,
    letterSpacing: -4,
    lineHeight: 96,
  },
  bpmUnit: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.textMuted,
    letterSpacing: 2,
  },
  statusText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  bodySmall: {
    fontSize: 12,
    fontWeight: '400' as const,
    color: Colors.textMuted,
    lineHeight: 17,
  },
  btnLabel: {
    fontSize: 15,
    fontWeight: '700' as const,
    letterSpacing: 0.3,
  },
  toggleLabel: {
    fontSize: 17,
    fontWeight: '700' as const,
    letterSpacing: 1,
  },
} as const;

// ─── Spacing / shape ──────────────────────────────────────────────────────────
export const Spacing = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 22,
  xl: 32,
} as const;

export const Radius = {
  sm: 8,
  md: 12,
  lg: 18,
  xl: 24,
  full: 999,
} as const;
