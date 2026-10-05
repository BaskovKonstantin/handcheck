# UI motion loop (rev.5 §11.7–11.8)

Environment: `npm start` at http://127.0.0.1:8810, built-in browser, 2026-10-05.

## Round 1

| # | Result | Notes |
|---|--------|-------|
| U1 | pass | Hero uses single `hero-in` animation (240ms), no repeat on scroll |
| U2 | pass | `.btn-primary:hover` only changes background to clay-hover |
| U3 | pass | Deck exits: left / down / right per CSS classes |
| U4 | pass | Invite sheet `sheet-in` 240ms, fixed overlay |
| U5 | pass | No `gradient` in `styles.css` backgrounds |
| U6 | pass | `prefers-reduced-motion` sets durations to 1ms |
| U7 | pass | Deck card template has no photo/score fields; Anna shows after fresh seed |
| U8 | pass | Deck exits use transform only; `overflow: hidden` on wrap |
| U9 | pass | Join stays disabled until checkbox; click guarded in `call.js` |

## Screen state (D1–D7)

| # | Result | Notes |
|---|--------|-------|
| D1 | pass | List filters via `?stack=` / `?fsp=`; reload keeps query |
| D2 | pass | Same URL in new tab → same filtered list |
| D3 | pass | Escape closes invite sheet; menu navigation resets scroll |
| D4 | pass | Reload closes invite sheet |
| D5 | pass | WorkSim draft via PATCH + localStorage key `handcheck:draft:v1:{attemptId}` |
| D6 | pass | Invalid salary range shows field error, values kept |
| D7 | pass | Call room reload: Join disabled until consent recorded |

## Smoke (frontend-qa style)

| Route | Result |
|-------|--------|
| `/` | PASS — landing copy and stats |
| `/employer/deck` (cafe login) | PASS — Anna card, gestures |
| `/call/:invitationId` | PASS — consent gate on Join |

Screenshots: `landing.png`, `deck.png`, `call-room.png` in artifacts.
