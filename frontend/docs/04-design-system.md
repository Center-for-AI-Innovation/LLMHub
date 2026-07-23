# Design System — UIUC Illinois Brand

This document is the source of truth for styling decisions in this frontend.
The system is built on **Tailwind CSS 3** + **shadcn/ui** and grounded in the
[UIUC Brand Guidelines](https://brand.illinois.edu/visual-identity/color/).

---

## Color Architecture — Two Layers

### Layer 1: Semantic tokens (preferred)

Defined as **HSL component variables** in `app/globals.css` (`:root` / `.dark`).
Mapped to Tailwind utilities in `tailwind.config.ts`.

**Advantage:** supports Tailwind opacity modifiers (`/10`, `/50`, etc.).

```tsx
// Good — transparency works
<div className="bg-primary/10 text-primary" />
<div className="bg-destructive/15 text-destructive" />
```

| Utility | Light value | Meaning |
|---|---|---|
| `primary` | Illini Blue `#13294B` | Main brand color, headings, active states |
| `primary-foreground` | White | Text/icons on primary bg |
| `secondary` / `accent` | Illini Orange `#FF5F05` | CTA, highlights, active tab indicator |
| `muted` | Light blue-gray `#EEF1F7` | Subtle backgrounds, tags |
| `muted-foreground` | Mid blue-gray | De-emphasized text, captions |
| `background` | White | Page / card surface |
| `foreground` | Illini Blue `#13294B` | Default body text |
| `border` | Light blue-gray | Dividers, input borders |
| `ring` | Illini Blue | Focus rings |
| `destructive` | Red | Errors, delete actions |
| `status-success` | ≈ Patina `#007E8E` | Success states, running |
| `status-info` | ≈ Industrial `#1D58A7` | Info states, launching |
| `status-neutral` | ≈ Harvest `#FCB316` | Neutral/warning states |

All tokens automatically switch in `.dark`. The `status-*` tokens lighten
in dark mode for sufficient contrast.

### Layer 2: Illinois brand tokens (solid fills only)

Loaded from the CDN: `https://cdn.brand.illinois.edu/illinois.css`
(already in `app/layout.tsx`). Mapped to Tailwind under `colors.illinois.*`.

**Limitation:** These are hex CSS variables and **do not support opacity modifiers**.
Use the semantic layer when transparency is needed.

```tsx
// Good — solid fill, no opacity needed
<div className="bg-illinois-blue text-illinois-white" />

// Bad — /10 opacity won't work with hex vars
<div className="bg-illinois-orange/10" />  // use bg-secondary/10 instead
```

| Utility | Hex | UIUC name |
|---|---|---|
| `illinois-orange` | `#FF5F05` | Illini Orange (primary) |
| `illinois-blue` | `#13294B` | Illini Blue (primary) |
| `illinois-altgeld` | `#C84113` | Altgeld Orange (accessible contrast) |
| `illinois-storm` | `#707372` | Storm (secondary gray) |
| `illinois-storm-60` | `#8E9090` | Storm 60% |
| `illinois-storm-80` | `#C6C7C6` | Storm 80% |
| `illinois-industrial` | `#1D58A7` | Industrial (supporting) |
| `illinois-arches` | `#009FD4` | Arches (supporting) |
| `illinois-patina` | `#007E8E` | Patina (supporting) |
| `illinois-berry` | `#5C0E41` | Berry (supporting) |
| `illinois-harvest` | `#FCB316` | Harvest (supporting) |
| `illinois-prairie` | `#006230` | Prairie (supporting) |
| `illinois-earth` | `#7D3E13` | Earth (supporting) |

Per brand guidelines, **supporting colors** are for charts/infographics only —
never large background floods.

---

## Typography

| Utility | Font | Use |
|---|---|---|
| `font-display` | Montserrat (CDN) | Headings, brand marks, page titles |
| `font-sans` | Source Sans 3 (CDN) | Body text, UI labels — default |
| `font-mono` | System monospace | Code blocks, log viewers |

`h1`–`h6` are globally set to `font-display` in `globals.css`.
Use `font-display` explicitly on brand-mark text, hero headings, and card titles.

```tsx
<h2 className="font-display text-2xl text-primary">Deploy a Model</h2>
<span className="font-display font-bold text-primary">LLM Hub</span>
```

---

## Spacing

The Tailwind **4 px base scale** is the canonical spacing system.
Prefer standard steps: `1 (4px)`, `2 (8px)`, `3 (12px)`, `4 (16px)`,
`6 (24px)`, `8 (32px)`, `12 (48px)`, `16 (64px)`.

---

## Border Radius

The design system uses a single `--radius` variable (`0.5rem`) as an anchor.

| Utility | Value | Use |
|---|---|---|
| `rounded-sm` | `0.25rem` | Small insets |
| `rounded-md` | `0.375rem` | Badges, chips |
| `rounded-lg` | `0.5rem` | Inputs, dropdowns, cards |
| `rounded-xl` | `0.75rem` | Elevated cards, panel headers |
| `rounded-2xl` | `1rem` | Feature cards, model cards |
| `rounded-full` | `9999px` | Pills, avatars, circular toggles — **intentional** |

Avoid arbitrary radius values (`rounded-[1.5rem]`, `rounded-3xl`). Use the
nearest canonical step from the table above.

---

## Borders

Always use the `border-border` semantic token for dividers and input borders.
This adapts automatically in dark mode.

```tsx
// Good
<div className="border border-border" />

// Bad — hardcoded
<div className="border border-zinc-200 dark:border-zinc-700" />
```

---

## Status Colors — Quick Reference

| State | Tailwind classes |
|---|---|
| Pending / warning | `bg-secondary/10 text-secondary-accessible` |
| Launching / info | `bg-status-info/10 text-status-info` |
| Running / success | `bg-status-success/10 text-status-success` |
| Failed / error | `bg-destructive/10 text-destructive-accessible` |
| Shutdown / neutral | `bg-muted text-muted-foreground` |

Use the `-accessible` text variant whenever `secondary`/`destructive` text sits on
its own `/10` tinted background — the DEFAULT lightness is tuned for solid CTA
fills (paired with white foreground text) and does not meet WCAG AA (4.5:1)
for text-on-tint at that opacity.

---

## Do / Don't

```tsx
// ✓ Use semantic tokens for anything needing opacity
<div className="bg-primary/5 text-primary" />
<div className="bg-status-success/15 text-status-success" />

// ✓ Use illinois-* for solid brand fills (no opacity needed)
<div className="bg-illinois-blue text-illinois-white" />

// ✗ Never hardcode hex in Tailwind classes
<div className="bg-[#13294B] text-[#FF5F05]" />

// ✗ Never use non-brand palettes (zinc, gray, blue, amber, green, red, etc.)
<div className="bg-zinc-900 text-emerald-500" />

// ✗ Never inline fontFamily — use font-display or font-sans utilities
<span style={{ fontFamily: 'Montserrat, ...' }} />
```
