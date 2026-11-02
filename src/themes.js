// Theme system: dark and light (App.jsx persists the choice to localStorage
// and sets it as `data-theme` on <html>, which drives the CSS variable
// overrides in index.css) - defaulting to the OS/browser's own
// prefers-color-scheme when nothing has been explicitly chosen yet. Category
// colors deliberately stay constant across themes - they carry meaning (this
// category = this hue) that shouldn't have to be re-learned per theme - only
// the surrounding chrome, glow, and edge treatment change.

// Graph-canvas values painted from JS in BrainGraph3D.jsx rather than plain
// CSS (edge colour and strength-to-alpha) - kept here instead of as CSS
// variables since JS already owns those computations.
export const THEME_GRAPH_CONFIG = {
  dark: {
    edgeColorRgb: '136, 117, 255',
    edgeAlphaBase: 0.15,
    edgeAlphaRange: 0.6
  },
  light: {
    edgeColorRgb: '111, 91, 230',
    edgeAlphaBase: 0.18,
    edgeAlphaRange: 0.55
  }
}

export function getGraphTheme(theme) {
  return THEME_GRAPH_CONFIG[theme] || THEME_GRAPH_CONFIG.dark
}
