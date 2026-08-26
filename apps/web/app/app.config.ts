/**
 * The `bonking. Core` tokens, transcribed from `docs/DESIGN.md`.
 *
 * Monochrome by decision, not by omission: colour is reserved almost entirely
 * for operational state, so nothing decorative competes with money and status.
 * The three semantic colours are deepened one step from their usual bright
 * values so they sit correctly against a cool near-white ground and never
 * outshout the black.
 *
 * T-15 transcribes these; it does not choose them. A change here without a
 * change in `docs/DESIGN.md` is a bug in this file.
 */
export default defineAppConfig({
  ui: {
    colors: {
      primary: 'obsidian',
      secondary: 'graphite',
      neutral: 'graphite',
      success: 'moss',
      info: 'graphite',
      warning: 'amber',
      error: 'crimson',
    },
    button: {
      defaultVariants: { size: 'md' },
    },
  },

  /** Named so a component can reach a token without hard-coding a hex. */
  bank: {
    surface: '#F6F6F7',
    surfaceContainer: '#E9E9EC',
    surfaceContainerLow: '#F0F0F2',
    onSurface: '#23242A',
    onSurfaceVariant: '#5A5B63',
    outline: '#75767F',
    outlineVariant: '#C6C6CC',

    /** The lacquered obsidian of primary surfaces — a gradient, not a fill. */
    primarySheen: 'linear-gradient(180deg, #2E313C 0%, #17191F 58%)',
    primaryHighlight: 'rgba(255, 255, 255, 0.14)',
    primary: '#0B0C10',
    action: '#17191F',
    silver: '#A8A9B2',

    success: '#1E7A3C',
    onSuccessContainer: '#186A32',
    warning: '#B4740A',
    onWarningContainer: '#7A4F06',
    error: '#B01B1B',
    errorContainer: '#F7DCD7',
    onErrorContainer: '#8A1010',
    tertiary: '#8E2A0E',
  },
});
