# HandCheck — design system (rev.5)

## Reference

Composition follows [Mercor](https://mercor.com) (header, hero, metrics, row-link, three steps). **Palette is HandCheck clay/forest on paper — never Mercor indigo `#4F46E5`.**

## Palette (CSS variables)

| Token | Value | Use |
|-------|-------|-----|
| `--paper` | `#F7F4EE` | Page background |
| `--card` | `#FFFCF8` | Cards, hover rows |
| `--ink` | `#1A2332` | Primary text |
| `--muted` | `#5E6A7A` | Secondary text |
| `--line` | `#E4DDD2` | Borders |
| `--clay` | `#C2410C` | Primary actions |
| `--clay-hover` | `#9A3412` | Primary hover |
| `--forest` | `#1F4D3A` | Accents, category pill |
| `--forest-soft` | `#E5F0EA` | Soft accent bg |
| `--danger` | `#9F2D2D` | Errors |
| `--on-clay` | `#FFFFFF` | Text on clay buttons |

Font: `Inter, Segoe UI, sans-serif`.

## What we copy from Mercor

- Top nav with logo and primary CTA
- Hero headline + lede + metrics row
- Three-step “how it works”
- List rows as full-width links (`.row-link`)

## What we do not copy

- Indigo/violet brand color
- Gradients, heavy shadows, infinite pulse animations
- Numeric skill badges or ratings in UI
- Photos / avatar placeholders in deck

## Components

- `.btn-primary` — clay fill, 160ms background transition, no scale
- `.btn-ghost` — transparent, line border
- `.stat` — landing counter block
- `.row-link` — employer list row, hover → `--card` 160ms
- `.category-pill` — forest-soft bg, opacity-only motion
- `.invite` — invitation card
- Form fields on `--card` with clay 2px focus ring
- `.deck-card`, `.deck-actions` — swipe directions (left/down/right)
- `.call-room` — 16:9 video, static recording dot (clay, no pulse)

## Empty / error / focus

- Empty list: short Russian copy, link to next action
- Field error: text appears with 4px translateY, 160ms
- Focus: 2px clay outline

## Motion tokens (§10.1)

```css
--ease-out: cubic-bezier(0.2, 0.8, 0.2, 1);
--dur-fast: 160ms;
--dur: 240ms;
--dur-deck: 320ms;
```

Only animate `opacity` and `transform`. No bounce, elastic, infinite pulse, parallax, gradient animation, confetti, skeleton shimmer, blur transitions, button scale, animated box-shadow.

### Gesture table

| Place | Motion | Duration |
|-------|--------|----------|
| Landing hero | translateY(8px) + opacity in | 240ms |
| Stats | stagger +40ms each | 240ms |
| Row / nav hover | background → card | 160ms |
| Deck exit | left -72px / down 48px / right 72px + opacity 0 | 320ms |
| Deck enter | translateY(12px) + opacity in | 240ms |
| Invite sheet | translateY(16px) + opacity | 240ms |
| Cabinet section | translateY(8px) + opacity | 200ms |
| Call room video | opacity in | 240ms |

`prefers-reduced-motion: reduce` — durations → ~0; deck still swaps card instantly.
