# Neuroverse brand assets

The Neuroverse mark ("E4"): a big memory linked to two smaller ones. The
purple hub is the app accent, the blue is Career, and the orange spark is
Preferences.

| File | Use |
|---|---|
| `neuroverse-mark.svg` | Mark for dark backgrounds (also `public/favicon.svg`) |
| `neuroverse-mark-on-light.svg` | Mark for light backgrounds |
| `neuroverse-lockup-on-dark.svg` / `-on-light.svg` | Mark + "Neuroverse" wordmark |
| `neuroverse-mark{,-on-light}-{512,192,32}.png` | Transparent PNG exports (app icons, social, favicons) |

## Geometry (24 × 24 viewBox)

- Hub: circle at (9, 13), r 4.6
- Blue node: (16.4, 8.6), r 3, linked to the hub
- Orange node: (15, 17.6), r 1.9, linked to the hub
- Links: 1.6 stroke, round caps, hub colour

## Colours

| Part | On dark | On light |
|---|---|---|
| Hub + links | `#8875ff` | `#6f5be6` |
| Blue node | `#56b7fc` | `#2e80fc` |
| Orange node | `#ff8c1a` | `#ff8c1a` |

In the app the mark is `BrainIcon` in `src/components/icons.jsx` (the hub
uses the theme accent via `currentColor`). To re-export the PNGs after a
change, render each SVG with headless Chrome at 512/192/32 px on a
transparent background.
