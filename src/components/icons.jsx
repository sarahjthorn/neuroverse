// Shared minimal stroke-SVG icons (currentColor, 16x16 viewBox), kept in one
// place so every use draws the identical glyph.

// The app mark ("E4"): a big memory linked to two smaller ones - the
// purple hub takes the theme accent, the orange spark is Preferences'.
export function BrainIcon() {
  return (
    <svg className="brain-logo" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path d="M9 13L15 9.5M9 13L15 17.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="9" cy="13" r="4.6" fill="currentColor" />
      <circle cx="16.4" cy="8.6" r="3" className="brain-logo-blue" />
      <circle cx="15" cy="17.6" r="1.9" fill="#ff8c1a" />
    </svg>
  )
}

export function EditIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 2.5l2.5 2.5-8 8H3v-2.5z" />
    </svg>
  )
}

export function SaveIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8.5l3 3 7-7" />
    </svg>
  )
}

export function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 4.5h11" />
      <path d="M5.5 4.5v-1a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1" />
      <path d="M4 4.5l.6 8a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9l.6-8" />
    </svg>
  )
}

export function SearchIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <circle cx="6.8" cy="6.8" r="4.3" />
      <path d="M10.3 10.3L14 14" />
    </svg>
  )
}

export function PaletteIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <circle cx="4.5" cy="5" r="1.6" />
      <circle cx="11.5" cy="5" r="1.6" />
      <circle cx="4.5" cy="11" r="1.6" />
      <circle cx="11.5" cy="11" r="1.6" />
    </svg>
  )
}

export function RecenterIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1.5v2.5M8 12v2.5M1.5 8H4M12 8h2.5" />
      <circle cx="8" cy="8" r="5.2" />
    </svg>
  )
}

export function CometIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <circle cx="11" cy="5" r="2.2" fill="currentColor" stroke="none" />
      <path d="M9.4 6.6L3 13M8.2 5.2L4.2 9.2M10.8 7.8L6.8 11.8" />
    </svg>
  )
}
