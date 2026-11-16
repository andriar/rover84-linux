# keyboard-config — UI rework design brief

Date: 2026-11-16. Author: app-designer (BRIEF mode). Run: `kbcfg-ui-rework-2026-11-16`.
Evidence: `ui-score-reports/2026-11-16-master.md` (mean 71/100), `ux-flow-reports/2026-11-16-keyboard-config.md`, current `src/style.css`, `src/remap/main.ts`, `src/rgb/main.ts`, `src/main.ts`, and a screenshot of the remap page.

Scope: visual and interaction design only. No new dependencies, no framework, plain CSS plus the `el()` helper. The behaviour stays the same, with four exceptions. Each one fixes a correctness or accessibility problem, and each is marked **[behaviour]** where it appears:
1. Restoring focus after a re-render (section 9.1).
2. Listen mode stops after one key, so Tab is no longer trapped (section 5.4).
3. When the swap is on, the board puts the Alt and Super key codes on the keys that actually send them (section 5.5).
4. VIA "Reset to defaults" asks for confirmation inline (section 7).

---

## 1. Direction

This is a control panel for one physical object, so the object is the interface. On every page the main thing on screen is a drawing of the Rover 84, built by one shared board component. On Key remap the drawing shows what each key types. On Lighting it shows how the keyboard glows. Settings and buttons sit around the drawing like the side panel of a hardware configurator, not like a web form.

**The one idea: a single accent keycap.** Keyboard people often fit one colored keycap, such as a blue Esc, on an otherwise neutral board. This app spends its one accent color, cobalt, the same way. Cobalt marks only two things: what you changed (a remapped key, the selected key) and the action that commits it (Apply). Everything else is graphite neutrals. Status colors (green, amber, red) are a separate set and always come with words.

Tone: calm, exact and slightly technical. There are no gradients, glows, emoji or decorative icons. When the app does not know something (speed direction, untested modes), the UI says so plainly instead of hiding it.

Theme: light and dark, both designed on purpose, switched by `prefers-color-scheme`. The lighting preview plate stays dark in both themes, because it is a picture of a lit object, not UI chrome.

---

## 2. Tokens

Replace the `:root` block in `src/style.css` with this. Every value is final.

```css
:root {
  color-scheme: light dark;

  /* Neutrals: graphite, slight cool bias (hue ~215) */
  --bg:            #F3F4F6;  /* page */
  --surface:       #FFFFFF;  /* cards, inputs */
  --sunken:        #E9ECF0;  /* board plate, segmented track, disabled fill */
  --border:        #D9DDE3;  /* card + divider lines (decorative) */
  --control:       #7D8694;  /* input/button/switch borders (UI boundary, >=3:1) */
  --text:          #15181D;
  --muted:         #4F5864;  /* helper text, secondary labels */
  --text-disabled: #7A828E;

  /* Accent: cobalt, used only for "changed" + "commit" */
  --accent:        #2B4FD8;
  --accent-hover:  #2342B8;
  --on-accent:     #FFFFFF;
  --accent-tint:   #E6EBFC;  /* remapped-key fill */

  /* Semantic (never used as accent) */
  --good: #17703A;  --good-bg: #E5F4EA;
  --warn: #8A5300;  --warn-bg: #FBF0D9;
  --bad:  #B4261B;  --bad-bg:  #FCE9E7;

  /* Keycaps */
  --cap:           #FFFFFF;
  --cap-edge:      #BFC5CE;  /* side border */
  --cap-lip:       #9AA2AE;  /* 2px bottom edge, draws the cap's depth */

  /* Lighting preview plate: fixed, same in both themes */
  --plate:         #14161A;
  --cap-off:       #23262C;
  --cap-off-edge:  #2E3238;

  /* Type */
  --font: system-ui, -apple-system, "Segoe UI", sans-serif;
  --mono: ui-monospace, "JetBrains Mono", monospace;
  --fs-12: 0.75rem;  --fs-14: 0.875rem;  --fs-16: 1rem;  --fs-20: 1.25rem;  --fs-24: 1.5rem;
  --lh-body: 1.5;    --lh-tight: 1.25;

  /* Space (4-based) */
  --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s5: 24px; --s6: 32px; --s7: 48px;

  /* Radius */
  --r-sm: 6px;   /* buttons, inputs, keycaps, segmented items */
  --r-md: 10px;  /* cards, banners, plate */
  --r-full: 999px; /* badges, switch */

  /* Elevation */
  --e1: 0 1px 2px rgb(15 17 20 / 0.06);
  --e2: 0 -4px 16px rgb(15 17 20 / 0.08);   /* sticky apply bar only */

  /* Focus */
  --focus: 2px solid var(--accent);
  --focus-offset: 2px;

  /* Motion */
  --dur-1: 100ms;   /* hover / press color */
  --dur-2: 160ms;   /* switch thumb, banner appear */
  --ease: cubic-bezier(0.2, 0, 0, 1);

  /* Target */
  --target: 44px;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0F1114;  --surface: #171A1F;  --sunken: #1E2228;  --border: #2B3038;
    --control: #6B7480;  --text: #E8EAEE;  --muted: #A4ABB6;  --text-disabled: #757D89;
    --accent: #8AA4FF;  --accent-hover: #A3B7FF;  --on-accent: #0A1230;  --accent-tint: #1F2A4D;
    --good: #5BC98A; --good-bg: #13271B;
    --warn: #E9B551; --warn-bg: #2A2112;
    --bad:  #FF8A7F; --bad-bg:  #2E1715;
    --cap: #232830;  --cap-edge: #3A414C;  --cap-lip: #12151A;
    --e1: none;  --e2: 0 -1px 0 var(--border);
  }
}

@media (prefers-reduced-motion: reduce) {
  :root { --dur-1: 0ms; --dur-2: 0ms; }
}
```

### 2.1 Contrast (computed, WCAG 2.x relative luminance)

| Pair | Light | Dark | Requirement |
|---|---|---|---|
| text on bg | 16.17 | 15.70 | 4.5 |
| text on surface | 17.79 | 14.48 | 4.5 |
| muted on surface | 7.21 | 7.54 | 4.5 |
| muted on bg | 6.55 | 8.18 | 4.5 |
| muted on sunken | 6.08 | 6.91 | 4.5 |
| accent (as text/link) on surface | 6.54 | 7.34 | 4.5 |
| on-accent on accent (primary button) | 6.54 | 7.74 | 4.5 |
| on-accent on accent-hover | 8.26 | 9.43 | 4.5 |
| text on accent-tint (remapped key) | 14.96 | 11.65 | 4.5 |
| muted on accent-tint | 6.06 | 6.07 | 4.5 |
| good on good-bg | 5.41 | 7.62 | 4.5 |
| warn on warn-bg | 5.60 | 8.45 | 4.5 |
| bad on bad-bg | 5.55 | 7.36 | 4.5 |
| bad on surface (danger button text) | 6.49 | 7.64 | 4.5 |
| control border on surface | 3.68 | 3.68 | 3.0 (UI boundary) |
| control border on bg | 3.34 | 3.99 | 3.0 |
| focus ring (accent) on bg | 5.94 | 7.96 | 3.0 |
| text on cap | 17.79 | 12.30 | 4.5 |
| muted on cap (locked legend) | 7.21 | 6.40 | 4.5 |
| disabled text on sunken | 3.27 | 3.84 | exempt; kept >= 3 so it stays readable |

`--border` (1.7:1) is decorative only: card edges and dividers. Every control boundary uses `--control`. Keycaps are identified by their legend (>= 6:1), so their edge colour is not a requirement.

### 2.2 Type roles

| Role | Size / weight / line-height | Use |
|---|---|---|
| Page title (h1) | 24 / 600 / 1.25 | One per page: "Key remap", "Lighting", "VIA editor" |
| Card title (h2) | 20 / 600 / 1.25 | "Keyboard settings", "Key mappings", "Backlight" |
| Body | 16 / 400 / 1.5 | Banner body, empty-state text; max 65ch |
| Label | 14 / 600 | Field labels, buttons, nav items |
| Helper | 14 / 400, `--muted` | Text under a control |
| Caption | 12 / 600, uppercase, letter-spacing 0.06em, `--muted` | Board legend group, picker group headings |
| Key legend | 12 / 600 (multi-char), 14 / 600 (single char) | Keycaps |
| Raw value | 12 / 400, `--mono` | Device input names, raw record hex, error details |

Numbers: `font-variant-numeric: tabular-nums` on counts and step values. Nothing smaller than 12px.

---

## 3. App shell (all three pages)

Build it once as `src/ui/shell.ts`, exporting `shell({ page, chip, banner, main, bar })`. Each page passes its own content, and the header markup lives in one place.

```
<body>
  <a class="skip" href="#main">Skip to content</a>          (visible on focus)
  <header class="app-header">
    <span class="brand">keyboard-config</span>             (14/600, --mono, --muted)
    <nav aria-label="Tools">
      <a href="/"         aria-current="page">Key remap</a>
      <a href="/rgb.html">Lighting</a>
      <span class="nav-sep" aria-hidden="true"></span>     (1px x 20px --border)
      <a href="/via.html" class="secondary">VIA editor</a>
    </nav>
    <span class="chip badge ...">Remap on</span>           (page status chip, right)
  </header>
  <div class="banner-slot"></div>                           (0 or 1 banner)
  <main id="main"> h1 + page content </main>
  <div class="apply-bar"> ... </div>                        (sticky bottom; Remap and Lighting only)
  <div id="live-status" role="status" class="sr-only"></div>
  <div id="live-alert"  role="alert"  class="sr-only"></div>
</body>
```

**Nav.** Each item is an `<a>` with `min-height: 44px`, `padding: 0 var(--s3)`, a 14/600 label and a `--text` colour. The current page gets `aria-current="page"`, a 2px bottom bar in `--text` and no extra fill. The bar is not accent-coloured, because the accent is kept for changes. Hover sets the background to `--sunken`. "VIA editor" is secondary: 14/400 in `--muted` after a divider, so it is clearly the odd one out without being hidden.

**Status chip** (right of header; it says what the device is doing, not what the app is doing):
- Remap: `Remap on` (good) / `Remap off` (neutral) / `Checking…` (neutral)
- Lighting: `Keyboard connected` (good) / `Keyboard not found` (bad) / `Reading…` (neutral)
- VIA: `Not connected` (neutral) / `Connected` (good)

**Banner slot.** This slot is for page-level problems only, and shows at most one banner, chosen by priority:
`server unreachable` > `Hyprland unreachable` > `keyboard absent / no permission` > `unrecognized record`.
Banners never carry success messages.

**Where feedback goes.**
- The result of an action appears in the **result line inside the apply bar**, directly left of the button that caused it. It is never in the header and never in a corner.
- The visible result line is plain text. Its text is also written into the persistent `#live-status` element (ok/info) or `#live-alert` element (errors). These two live regions sit outside the re-rendered subtree, so screen readers still announce them after `replaceChildren`.
- The old header status line (`.status`) is deleted.

**Shell spacing.** `max-width: 1200px; margin: 0 auto`. Padding is `var(--s4)` below 1024px and `var(--s6)` at 1024px and up. The vertical gap between shell rows is `var(--s5)`. The header is a flex row with `gap: var(--s4)` and wraps below 768px (brand and chip on the first row, nav on the second).

---

## 4. Components

All interactive controls: `min-height: var(--target)` (44px), `font: inherit`, transitions only on `background-color, border-color, color` with `var(--dur-1) var(--ease)`.
Focus for everything: `:focus-visible { outline: var(--focus); outline-offset: var(--focus-offset); }`. Never remove the outline without replacing it.
Disabled for everything: do **not** use `opacity`. Use `background: var(--sunken); color: var(--text-disabled); border-color: transparent; cursor: not-allowed`. Every disabled control that matters has a **visible** reason next to it. A `title` tooltip is not enough.

### 4.1 Button

| Variant | Default | Hover | Use |
|---|---|---|---|
| primary | bg `--accent`, text `--on-accent`, border same | bg `--accent-hover` | One per view: Apply |
| secondary | bg `--surface`, text `--text`, 1px `--control` | bg `--sunken` | Turn off remap, Turn lights off, Try again |
| ghost | transparent, text `--text`, no border | bg `--sunken` | Listen, Re-read keyboard, Show details |
| danger | bg `--surface`, text `--bad`, 1px `--bad` | bg `--bad-bg` | Restore original, Reset to defaults (opens confirm) |
| danger-confirm | bg `--bad`, text `--surface` (light) / `#1A0E0D` (dark) | darken 8% | "Yes, restore" inside confirm-inline |

Size: `min-height: 44px; padding: 0 var(--s4); border-radius: var(--r-sm); font-size: var(--fs-14); font-weight: 600`.
States:
- **focus**: shared ring.
- **disabled**: shared rule, plus a visible reason (see each page).
- **selected** (toggle buttons such as Listen): `aria-pressed="true"`, background `--accent-tint`, 1px `--accent` border, text `--text`.
- **busy**: `aria-busy="true"`, `disabled`, label becomes the progress word ("Applying…", "Writing…", "Reading…"). Before switching, set `min-width` to the button's current width so the row does not jump. Use no spinner; the word is enough.

### 4.2 Toggle switch

Use `<button type="button" role="switch" aria-checked="true|false" id="swap">` with a `<label for="swap">` and a helper `<p id="swap-help">`. The button gets `aria-describedby="swap-help"`.
- Hit area 52×44. Inside it: track 44×24 (`border-radius: var(--r-full)`) and a 18px thumb.
- Off: track `--surface` with a 1px `--control` border, thumb `--control`.
- On: track `--accent`, thumb `--on-accent`, thumb moved 20px right (`transition: transform var(--dur-2) var(--ease)`).
- Hover: track border `--text` (off) or `--accent-hover` (on). Focus: shared ring around the 52×44 box. Disabled: shared rule plus a reason.
- Layout: label (14/600) on the left, switch on the right, helper text on its own line below, max 65ch. Label and helper never share a line. This fixes the run-together text in the screenshot.

### 4.3 Segmented tabs (picker categories, VIA layers)

This is a button group with `aria-pressed`, the same model as today. Each item is reachable with Tab.
- Track: `background: var(--sunken); border-radius: var(--r-sm); padding: 2px; display: flex; gap: 2px`.
- Item: `min-height: 40px` inside the 2px track padding, so the hit row is 44px. Padding `0 var(--s3)`, 14/600, text `--muted`.
- Selected: background `--surface`, text `--text`, `box-shadow: var(--e1)`. Selection uses no accent colour.
- Hover: text `--text`. Focus: shared ring.
- Below 768px, the 8 category tabs become `display: grid; grid-template-columns: repeat(4, 1fr)` (2 rows of 4). They never wrap unevenly, and the page never scrolls sideways.

### 4.4 Key cap (shared board, `src/ui/board.ts`)

**Geometry.** Positions come from CSS variables, not JS pixels:
```css
.board-wrap { container-type: inline-size; overflow-x: auto; }
.board {
  --u: clamp(44px, calc(100cqi / 16), 56px);   /* 16u wide, 6u tall */
  position: relative; width: calc(16 * var(--u)); height: calc(6 * var(--u)); margin-inline: auto;
}
.key { position: absolute; left: calc(var(--x) * var(--u)); top: calc(var(--y) * var(--u));
       width: calc(var(--w) * var(--u)); height: var(--u); padding: 0; border: 0; background: none; }
.key .cap { position: absolute; inset: 2px; border-radius: var(--r-sm); background: var(--cap);
            border: 1px solid var(--cap-edge); border-bottom: 2px solid var(--cap-lip);
            display: grid; place-items: center; font-size: var(--fs-12); font-weight: 600; }
```
In JS, set `key.style.setProperty("--x", …)` and likewise for `--y` and `--w`. Delete the `UNIT` constant. The **button covers the whole unit**, so the hit area is never below 44×44. The visible cap is inset by 2px, which gives the gap between keys.

**States** (all on `.cap` unless noted):

| State | Look | Notes |
|---|---|---|
| default | as above, legend `--text` | |
| hover | `.cap` background `--sunken` | |
| focus-visible | outline on `.cap`: `var(--focus)`, offset 1px | inside the 2px gap, never clipped |
| selected | `aria-pressed="true"`: 2px `--accent` border (all sides) | can combine with mapped |
| mapped | background `--accent-tint`; legend shows the **target** (e.g. `Esc` on the Caps key) | physical name goes in `aria-label` and the inspector |
| pending | 6×6 square, `--warn`, top-right corner (`.cap::after`, 4px inset) | this key's change is not applied yet |
| locked | border `1px dashed var(--control)`, background `--sunken`, legend `--muted` | full opacity; reason shown in inspector and legend |
| busy | no visual change; clicks still select | |

`aria-label` patterns: `"Caps Lock, types Escape, not applied yet"`, `"Left Ctrl, modifier, can't be remapped"`, `"F5"`.
Legend text: short physical names (`Esc, Bksp, Caps, Shift, Ctrl, Super, Alt, PgUp, PgDn`). Drop the `L`/`R` prefixes on the board, because position already shows the side. Keep full names ("Left Ctrl") in the `aria-label` and the inspector.

### 4.5 Color swatch

- `<button aria-pressed aria-label="Red">`: 44×44 hit area, visible 32px circle (`.dot`) centred, with a `inset 0 0 0 1px rgb(0 0 0 / 0.2)` ring so white is visible on white.
- Selected: a 2px `--text` ring at 2px offset around the dot, plus `aria-pressed="true"`.
- Hover: ring in `--control`. Focus: shared ring.
- Names for the 9 presets, in order: `Red, Orange, Yellow, Green, Sky blue, Blue, Violet, Pink, White`. The hex value is not used as a label.
- "Custom" color: a native `<input type="color" id="color-custom">`, 44×44, `border-radius: var(--r-sm)`, 1px `--control` border, with a visible `<label for="color-custom">Custom</label>` next to it. When no preset matches the current colour, the custom input shows the selected ring.

### 4.6 Stepped slider (Brightness, Speed)

```
Brightness                                  Medium
[=========o-----------------]               (native range, height 44px)
 Off     Low    Medium   High    Max        (tick labels, 12/400 --muted, 5-col grid)
```
- Use `<label for>` plus `<input type="range" min=0 max=4 step=1>` with `aria-valuetext="Medium (2 of 4)"`.
- The current value appears right-aligned on the label row (14/600, tabular-nums).
- Tick labels: a 5-column grid with ends aligned to the track ends (`justify-items: start | center | end`). They are text only, not interactive.
- Input: `width: 100%; height: 44px; accent-color: var(--accent)`.
- Disabled: shared rule plus a reason line under the ticks.

### 4.7 Select

Keep the native `<select>` with a `<label for>`. Style: `min-height: 44px; padding: 0 var(--s3); border: 1px solid var(--control); border-radius: var(--r-sm); background: var(--surface); color: var(--text); width: 100%; max-width: 24rem`. Hover changes the border to `--text`. Focus uses the shared ring. Use `<optgroup>` for grouping (the Lighting modes).

### 4.8 Badge

`display: inline-flex; align-items: center; height: 24px; padding: 0 var(--s2); border-radius: var(--r-full); font: 600 var(--fs-12)/1 var(--font); letter-spacing: 0.04em`. The badge text is always a word; colour never carries the meaning alone.

| Tone | Colors |
|---|---|
| good | text `--good`, bg `--good-bg` |
| warn | text `--warn`, bg `--warn-bg` |
| bad | text `--bad`, bg `--bad-bg` |
| neutral | text `--muted`, bg `--sunken` |
| untested | text `--warn`, bg transparent, 1px dashed `--warn` |

### 4.9 Banner

```
+--------------------------------------------------------------------+
| Can't reach the local server                         [ Try again ]  |
| Start it with npm start in the keyboard-config folder, then try     |
| again.                                                              |
| > Technical details                                                 |
+--------------------------------------------------------------------+
```
- `border-radius: var(--r-md); padding: var(--s4); border: 1px solid <tone>; background: <tone>-bg`. No side rail and no icon.
- Title 16/600 in `--text`. Body 14/400 in `--text`, max 65ch.
- Actions go top-right at 768px and up. Below 768px they sit under the body, full-width.
- "Technical details" is a `<details>` with a 44px-high `<summary>`. It holds the raw error text in `--mono` 12.
- Tone `bad` uses `role="alert"`. Tones `warn` and `info` use `role="status"`.
- Appearing: background fade `var(--dur-2)`. With reduced motion it simply appears.

### 4.10 Card

`background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-md); box-shadow: var(--e1); padding: var(--s4)` below 768px and `var(--s5)` from 768px up. The board card uses `padding-inline: var(--s3)` below 1024px so the board fits.
Card header row: h2 on the left, optional actions or badge on the right, `gap: var(--s3)`, `margin-bottom: var(--s4)`.
Card body: `display: grid; gap: var(--s4)`. Spacing comes from the gap; children have no `margin`.
Sibling cards always use the same padding.

### 4.11 Confirm-inline

Clicking a danger button replaces the button, in place, with:
```
Replace the current lighting with the original?   [ Yes, restore ]  [ Cancel ]
```
- `role="group"` with `aria-labelledby` pointing at the question text. Question 14/400.
- On open, **focus moves to Cancel**, the safe default. **Esc** cancels. On close, focus returns to the trigger button.
- If the page re-renders while it is open, it stays open (keep `confirmRestore` in state, as today).

### 4.12 Apply bar (sticky)

`position: sticky; bottom: 0; z-index: 1; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-md) var(--r-md) 0 0; box-shadow: var(--e2); padding: var(--s3) var(--s4); display: flex; flex-wrap: wrap; align-items: center; gap: var(--s3)`.
- Left side: the **summary line** (14/600) and, under it, the **result line** (14/400). The result line is coloured `--good` or `--bad` and always starts with a word ("Applied…", "Couldn't…").
- Right side (`margin-left: auto`): secondary button, then primary button.
- Below 768px: the text block takes the full width, and the buttons sit on their own row with `flex: 1` each.

---

## 5. Key remap page

### 5.1 Structure

1. **Keyboard settings** card: device filter and Alt/Super swap. These are settings, not mappings.
2. **Key mappings** card: the board, the Listen button and the legend.
3. **Selected key** card: an inspector with the picker.
4. **Apply bar**: one commit point for everything on the page.

Focal point: the board. The settings card is short (two columns at 768px and up), so the board is visible without scrolling at 1280×800.

### 5.2 Wireframes

**1280px** (grid `minmax(0, 1fr) 340px`, gap 24; the board unit is about 50px). Switch to two columns only at `min-width: 1200px`. Below that the main column would push the board unit under 44px, so the page stays single-column as at 768px.
```
+------------------------------------------------------------------------------------------+
| keyboard-config   Key remap  Lighting | VIA editor                          [Remap on]   |
|                   ‾‾‾‾‾‾‾‾‾                                                              |
| [banner slot]                                                                            |
| Key remap                                                                                |
| +-- Keyboard settings -------------------------------------------------------------------+ |
| | Keyboard name contains                    |  Swap Alt and Super                  [ o==] | |
| | [rover-84               ]                 |  Turn on when the keyboard is in Mac mode   | |
| | Found: Rover 84 V3 (2 inputs)  > names    |  (the Win key acts as Alt). Turn off in     | |
| |                                           |  Windows mode, or the keys swap twice.      | |
| +----------------------------------------------------------------------------------------+ |
| +-- Key mappings ------------------------ [Listen] -+ +-- Selected key ------------------+ |
| | [Esc][F1 ][F2 ] ...                    [Ins][Del] | | Caps Lock                        | |
| | [ ` ][ 1 ][ 2 ] ...               [ Bksp ][Home] | | Types Escape. Not applied yet.   | |
| | [Tab ][ Q ] ...                     [ \ ][PgUp] | | [Reset this key]                 | |
| | [Esc*][ A ] ...  (* = remapped, tinted)  [PgDn] | |                                  | |
| | [ Shift ][ Z ] ...           [Shift][ ↑ ][End] | | MAKE IT TYPE…                    | |
| | [Ctrl][Super][Alt][   Space   ][Alt][Ctrl][←↓→] | | [Search, e.g. Esc or F13      ]  | |
| |                                                   | | [Letters][Numbers][Punct][Mods]  | |
| | KEY  ■ Remapped  ■ Not applied  ┆ Modifier, fixed | | [Fn][Nav][Media][Special]        | |
| | Drawing is approximate. If a key is missing or in | | [A][B][C][D]                     | |
| | the wrong place, use Listen and press it.         | | [E][F][G][H] ...                 | |
| +---------------------------------------------------+ +----------------------------------+ |
| +-- apply bar ---------------------------------------------------------------------------+ |
| | 3 changes not applied: 2 keys, Alt/Super swap           [Turn off remap] [Apply 3 changes] |
| | Applied to Rover 84 V3 (2 inputs).                                                     | |
| +----------------------------------------------------------------------------------------+ |
```
The Selected key card is `position: sticky; top: var(--s4)` with `max-height: calc(100vh - 2 * var(--s4)); overflow-y: auto` on the picker grid, so the picker stays next to the board.

**768px** (one column; the board unit is about 44px and fits without scrolling)
```
+--------------------------------------------------+
| keyboard-config                      [Remap on]  |
| Key remap  Lighting | VIA editor                 |
| Key remap                                        |
| +-- Keyboard settings --------------------------+ |
| | Keyboard name contains   | Swap Alt and Super  | |
| | [rover-84         ]      |              [ o==] | |
| | Found: Rover 84 V3 (2)   | helper text ...     | |
| +-----------------------------------------------+ |
| +-- Key mappings ------------------- [Listen] --+ |
| | board 16u x 44px = 704px                       | |
| | legend + caption                               | |
| +-----------------------------------------------+ |
| +-- Selected key --------------------------------+ |
| | Caps Lock. Types Escape. Not applied yet.      | |
| | [Search                                    ]   | |
| | [Letters][Numbers][Punctuation][Modifiers]     | |
| | [Function][Navigation][Media][Special]         | |
| | picker grid repeat(auto-fill, minmax(88px,1fr))| |
| +-----------------------------------------------+ |
| [ apply bar, sticky ]                             |
+--------------------------------------------------+
```

**360px**
```
+------------------------------+
| keyboard-config  [Remap on]  |
| Key remap Lighting | VIA     |
| Key remap                    |
| +-- Keyboard settings -----+ |
| | Keyboard name contains   | |
| | [rover-84            ]   | |
| | Found: Rover 84 V3 (2)   | |
| | ------------------------ | |
| | Swap Alt and Super [o==] | |
| | helper text, own lines   | |
| +--------------------------+ |
| +-- Key mappings ----------+ |
| | [Listen]                 | |
| | Scroll sideways for the  | |
| | whole board, or use      | |
| | Listen.                  | |
| | |board 704px, scrolls  ->| |  <- only .board-wrap scrolls; body never does
| | legend (wraps)           | |
| +--------------------------+ |
| +-- Selected key ----------+ |
| | ... picker 2-3 cols      | |
| +--------------------------+ |
| +-- apply bar -------------+ |
| | 3 changes not applied    | |
| | [Turn off ] [ Apply 3  ] | |
| +--------------------------+ |
+------------------------------+
```
Show the "Scroll sideways…" hint only when the board overflows (`board-wrap.scrollWidth > clientWidth`, checked after render). Below 400px the nav label "VIA editor" may shorten to "VIA". The `aria-label` stays "VIA editor".

### 5.3 Apply button and count

**Pending changes** = the edited config compared with the last applied config (`ui.saved`):
- each key whose mapping was added, changed or removed counts as 1;
- `swapAltSuper` different counts as 1;
- `deviceMatch` different counts as 1.

| Situation | Summary line | Primary button | Secondary |
|---|---|---|---|
| N > 0 | `N change(s) not applied: <parts>`, where parts come from `2 keys`, `Alt/Super swap`, `keyboard name` | `Apply N change(s)` (enabled) | `Turn off remap` (enabled if active) |
| N = 0, remap active | `Remap is on. Everything is applied.` | `Applied` (disabled) | `Turn off remap` |
| N = 0, remap off, saved config exists | `Remap is off. Your mappings are saved.` | `Turn on remap` (enabled, applies saved) | `Turn off remap` (disabled) |
| no keyboard matched | `Can't apply: no keyboard found.` | `Apply…` (disabled) | as above |
| busy | unchanged | `Applying…` / `Turning off…` (busy) | disabled |

Examples: only the swap changed gives `1 change not applied: Alt/Super swap` and `Apply 1 change`. Two keys and the swap give `3 changes not applied: 2 keys, Alt/Super swap`.
When `deviceMatch` is edited but not applied, the Found line reads `Apply to see which keyboards match.`, because the matched list belongs to the old filter.

### 5.4 Listen [behaviour]

- Ghost toggle button in the Key mappings card header. Off: `Listen`. On: `aria-pressed="true"`, label `Press a key…`, and the board gets a 2px dashed `--accent` outline.
- **It captures one key, selects it and turns itself off.** Today Listen swallows every key including Tab, which traps keyboard users (WCAG 2.1.2). Clicking the button again while it is on also cancels.
- A key that is not on the board gives the result line `That key (<code>) isn't on the drawn board.` (bad), and Listen turns off.
- After a key is selected (by click or Listen), if the Selected key card is outside the viewport, call `scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })`.

### 5.5 Alt/Super swap on the board [behaviour]

The switch exists for Mac mode. In Mac mode the firmware already sends `AltLeft` from the key printed Win and `MetaLeft` from the key printed Alt. Today the board draws `MetaLeft` at the Win position. So with the swap on, clicking or Listening there targets the wrong physical key, and the labels contradict what the keys do.

Rule, driven by the **edited** `swapAltSuper` so the preview updates before Apply:
- Swap off: draw as today. The Win position is `MetaLeft` with legend `Super`; the Alt position is `AltLeft` with legend `Alt`.
- Swap on: **exchange the codes** of the two left BoardKey entries at draw time. The Win position becomes `AltLeft`, which the xkb swap turns into Super. The Alt position becomes `MetaLeft`, which turns into Alt. Each legend then matches the printed keycap **and** what the key types: `Super` at the Win position, `Alt` at the Alt position. Both caps get a 12/600 caption `swapped` in `--muted` below the legend. Their `aria-label` reads `"Super (Mac mode, swapped back)"`.
- Board legend adds `swapped = Alt/Super swap on` while the switch is on.
- The xkb option `altwin:swap_alt_win` also swaps **right** Alt with right Win (`/usr/share/X11/xkb/symbols/altwin`). With the swap on, the `AltRight` code types Super. Mark the right Alt cap `swapped` too, with legend `Super`. **Open question:** whether the Rover's Mac mode sends `AltRight` or `MetaRight` from that key. Verify with Listen on the hardware before release.

### 5.6 Locked modifier keys

- Cap: the locked style (4.4). The legend entry reads `┆ Modifier, can't remap` (a dashed swatch, drawn with CSS, not a glyph).
- Locked keys stay **selectable**, so they can explain themselves. When one is selected, the inspector shows:
  > **Left Ctrl can't be remapped.** A modifier key keeps acting as a modifier in xkb even when it gets a new symbol, so it would still work as Ctrl. Caps Lock is the one modifier that can be remapped.
- The picker grid stays visible but disabled, with the line `Pick another key to remap.` above it.

### 5.7 Inspector and picker

| State | Inspector heading / text | Picker |
|---|---|---|
| nothing selected | `No key selected` / `Select a key on the board, or press Listen and then the key.` | disabled, with the line `Select a key first.` above the grid |
| selected, unmapped | `Caps Lock` / `Types Caps Lock (default).` | enabled |
| selected, mapped, applied | `Caps Lock` / `Types Escape.` + `[Reset this key]` | enabled; current target has `aria-pressed="true"` and the selected style |
| selected, mapped, pending | `Caps Lock` / `Types Escape. Not applied yet.` + `[Reset this key]` | same |
| selected, locked | see 5.6 | disabled |
| search with no hits | — | `No key matches "<query>".` |

Picker items: secondary-style buttons, `min-height: 44px`, 14/600. The grid is `repeat(auto-fill, minmax(88px, 1fr))` with `gap: var(--s2)`. The search field is `type="search"` with `<label for>` "Search keys" (visually hidden) and the placeholder `Search, e.g. Esc or F13`.

### 5.8 Remap states

| State | Where | Copy |
|---|---|---|
| loading | chip `Checking…`. Board drawn immediately (it's static) with all caps in default style and Apply busy-disabled. No blank page. | result line: `Reading Hyprland…` |
| server unreachable (fetch throws TypeError) | banner bad | **Can't reach the local server** / `Start it with npm start in the keyboard-config folder, then try again.` / [Try again] |
| Hyprland unreachable (`warning`) | banner warn | **Hyprland isn't responding** / `Changes can't be applied until it does. Check that you're in a Hyprland session.` / details: raw warning / [Try again] |
| no keyboard matched | banner warn + Found line | **No keyboard matches "rover-84"** / `Plug the keyboard in, or change the name in Keyboard settings.` / details: `Keyboards Hyprland sees:` list in mono / [Try again] |
| apply ok | result line good | `Applied to Rover 84 V3 (2 inputs).` |
| turn off ok | result line good | `Remap turned off. Your mappings are saved, and the Alt/Super swap is unchanged.` |
| apply failed | result line bad | `Couldn't apply: <server message>` |

**Friendly device name** for the Found line: take the first matched name, split it on `-`, and drop empty parts. Drop the first part (the vendor) if more than 2 parts remain. Drop a trailing `keyboard`. Upper-case parts matching `/^v\d+$/` and capitalise the rest. So `telink-rover-84-v3--keyboard` becomes `Rover 84 V3`. Append ` (N inputs)` when N > 1. The raw names stay available in a `<details>` labelled `Show input names` (mono 12).

---

## 6. Lighting page

### 6.1 Structure

Left: a **Preview** card (the focal point) with a **Restore original** card below it. Right: the **Backlight** card with its controls, then the apply bar. The destructive action lives in its own card, away from Apply.
DOM order is always Preview, Backlight, Restore. At 1024px and up, place them with `grid-template-columns: minmax(0, 1fr) 360px; grid-template-areas: "preview controls" "restore controls"`. Below that the grid is a single column in DOM order, so tab order and reading order match at every width.

### 6.2 Wireframes

**1280px** (grid `minmax(0, 1fr) 360px`, gap 24)
```
+----------------------------------------------------------------------------------+
| keyboard-config   Key remap  Lighting | VIA editor              [Keyboard connected] |
|                              ‾‾‾‾‾‾‾‾                                             |
| Lighting                                                                          |
| +-- Preview ------------------------ [Re-read keyboard] -+ +-- Backlight --------+ |
| | +----------------------------------------------------+ | | Mode                | |
| | |  dark plate: 84 caps tinted with color @ brightness | | | [Static         v]  | |
| | |                                                    | | | Tested on this kbd. | |
| | +----------------------------------------------------+ | |                     | |
| | Static · Red · Medium                                  | | Color               | |
| | Color and brightness only; animations aren't shown.    | | (o)(o)(o)(o)(o)     | |
| | Re-reads when you come back to this window, because    | | (o)(o)(o)(o) [#]Custom| |
| | the keyboard's Fn keys can change it too.              | |                     | |
| +--------------------------------------------------------+ | Brightness   Medium | |
| +-- Restore original lighting ---------------------------+ | [=====o--------]    | |
| | Puts back the lighting the keyboard had before this    | | Off Low Med High Max| |
| | app first changed it.                [Restore original]| |                     | |
| +--------------------------------------------------------+ | Speed            2  | |
|                                                            | [=====o--------]    | |
|                                                            | 0   1   2   3   4   | |
|                                                            | helper (see 6.5)    | |
|                                                            |                     | |
|                                                            | Random colors [o==] | |
|                                                            | helper              | |
|                                                            +---------------------+ |
| +-- apply bar ---------------------------------------------------------------------+ |
| | Not written yet                              [Turn lights off] [Apply to keyboard] | |
| | Written and verified.                                                             | |
| +----------------------------------------------------------------------------------+ |
```

**768px**: one column. Order: Preview, Backlight, Restore original, apply bar. The color swatches sit in a single row (9 swatches + custom = 10 × 44 + gaps, about 520px).

**360px**
```
+------------------------------+
| keyboard-config [Connected]  |
| Key remap Lighting | VIA     |
| Lighting                     |
| +-- Preview ---------------+ |
| | [plate scaled to fit,    | |
| |  ~19px units, no legends]| |
| | Static · Red · Medium    | |
| | [Re-read keyboard]       | |
| +--------------------------+ |
| +-- Backlight -------------+ |
| | Mode [Static         v]  | |
| | Color                    | |
| | (o)(o)(o)(o)(o)(o)       | |
| | (o)(o)(o) [#] Custom     | |
| | Brightness ... ticks     | |
| | Speed ... ticks          | |
| | Random colors [o==]      | |
| +--------------------------+ |
| +-- Restore original ------+ |
| | text  [Restore original] | |
| +--------------------------+ |
| [apply bar: 2 buttons 50/50] |
+------------------------------+
```

### 6.3 Keyboard preview

- Reuse `BOARD` from `src/remap/keys.ts` and `src/ui/board.ts` in a **non-interactive** mode: caps are `<div>`, not buttons, and the board has `aria-hidden="true"`.
- The wrapper has `role="img"` with an `aria-label` like `"Preview: Static, Red, brightness Medium"`.
- Plate: `background: var(--plate); border-radius: var(--r-md); padding: var(--s3)`. Unit: `--u: min(56px, calc(100cqi / 16))` with **no minimum**, so the preview always fits and never scrolls.
- Caps have no legends. This is a picture of light, and legends would be unreadable at 19px units anyway.
- Cap fill: `background: color-mix(in oklab, var(--led) var(--glow), var(--cap-off)); border: 1px solid var(--cap-off-edge)`. `--led` is the chosen colour. `--glow` depends on brightness:

  | Brightness | 0 Off | 1 Low | 2 Medium | 3 High | 4 Max |
  |---|---|---|---|---|---|
  | `--glow` | 0% | 25% | 45% | 65% | 85% |

- **Random colors on**: each cap takes one of 6 fixed hues by `(x + y) mod 6`: `#FF3B30 #FF9500 #FFD60A #34C759 #0A84FF #BF5AF2`, using the same `--glow` mix. These are flat per-cap fills, not a gradient. The caption gains `Random colors: example pattern.`
- **Custom mode** (0x14, read from the keyboard): all caps `--cap-off`. Caption: `Custom per-key lighting is set on the keyboard. This app can't show or edit it.`
- No animation for animated modes. The caption says so, which keeps the page calm and avoids motion issues.
- Caption line 1 (14/600): `<Mode> · <Color name or hex> · <Brightness word>`. Line 2 (helper): `Color and brightness only; animations aren't shown.`

### 6.4 Mode: Tested vs Untested

- Native select with two `<optgroup>`s: **`Tested on this keyboard`** containing `Static`, and **`Untested`** containing the other 17 modes in the current order. If the keyboard holds Custom, a first option `Custom (per-key, set on keyboard)` is shown above both groups.
- Helper under the select:
  - Static: `Tested on this keyboard.`
  - Any untested mode: an `Untested` badge plus `Not tested on the Rover 84 yet. It may not look like its name. Switch back to Static any time.`

### 6.5 Brightness and speed in plain language

- Brightness: a stepped slider with ticks `Off · Low · Medium · High · Max`. The value label repeats the word. `aria-valuetext="Medium (2 of 4)"`.
- Speed: a stepped slider with ticks `0 · 1 · 2 · 3 · 4`. The numbers stay, because the direction is unknown and calling them Slow or Fast would be a guess.
  - Helper (animated modes): `Only affects animated modes. It isn't confirmed yet whether higher means faster or slower.`
  - **Static selected**: the slider is disabled (its value is kept and still written), with the reason `Static doesn't animate, so speed has no effect.`
- Random colors: a switch labelled `Random colors`, with the helper `Let the mode pick its own colors instead of the one above. Untested on this keyboard.`

### 6.6 Actions and placement

| Action | Style | Place | Notes |
|---|---|---|---|
| Apply to keyboard | primary | apply bar, far right | Label `Apply to keyboard` when there are edits. With no edits it becomes **secondary** `Write again`, still enabled as today. |
| Turn lights off | secondary | apply bar, left of Apply | Reversible: Apply restores the light. Not styled as danger. |
| Re-read keyboard | ghost | Preview card header | Was "Read from keyboard". The tooltip text becomes the visible caption. |
| Restore original | danger, then confirm-inline | its own card under Preview | Question: `Replace the current lighting with the original?` Buttons: `Yes, restore` / `Cancel`. No backup: disabled, with the visible reason `Nothing to restore yet. The original is saved the first time you apply.` |

Summary line in the apply bar: with edits, `Not written yet` (warn badge style, as text); with none, `Matches what the keyboard holds.`

### 6.7 Lighting states

| State | Where | Copy |
|---|---|---|
| loading | chip `Reading…`; preview plate drawn with all caps `--cap-off`; controls disabled | result: `Reading the keyboard…` |
| server unreachable | banner bad | same as Remap |
| keyboard absent or no permission (`present: false`) | banner bad; preview and controls hidden; Restore hidden | **Can't open the Rover 84** / `Plug the keyboard in with a USB cable. If it's already plugged in, the app may not have permission. Install the udev rule once (README, Lighting section), then unplug and replug it.` / [Try again] |
| unrecognized record | banner warn; controls and Apply disabled; preview hidden | **Writing is off to protect the keyboard** / `It holds a lighting record this app doesn't recognize.` / details: `Raw record` in mono |
| keyboard changed under the app (focus re-read differs from what was shown) | result line info (`--muted`) | `Updated from the keyboard. It was changed there, maybe with the Fn keys.` |
| write ok | result line good | `Written and verified.` |
| lights off ok | result line good | `Lights off. Written and verified.` |
| restore ok | result line good | `Original lighting restored.` |
| write failed | result line bad | `Couldn't write: <message>. Re-read the keyboard to see what it holds now.` |

---

## 7. VIA editor page (secondary)

- The nav item is secondary (section 3). h1: `VIA editor`.
- **Empty state** (not connected), as a card with `max-width: 65ch`:
  ```
  For keyboards with VIA firmware
  This editor changes keymaps on QMK keyboards that have VIA enabled. Your Rover 84 doesn't use VIA,
  so use Key remap and Lighting for it instead.

  [Connect a VIA keyboard]   [Try a demo keyboard]
  Needs Chrome or Edge (WebHID).            <- visible only when WebHID is unsupported; Connect is then disabled
  ```
  Both buttons are **secondary**. There is no primary action on this page until a keyboard is connected. "Mock device" is renamed `Try a demo keyboard`. "Key remap" and "Lighting" in the body text are links (accent, underlined, inline; the 44px rule does not apply to links inside running text).
- **Connected**: the chip reads `Connected`. Card header: layer tabs as segmented controls (`Layer 0`, `Layer 1`, …), then on the right `Import JSON` and `Export JSON` (secondary) and `Reset to defaults` (danger, then confirm-inline **[behaviour]**: `Reset every key on every layer to the firmware default?` / `Yes, reset` / `Cancel`). The board uses the shared board component; the `.trns` caps use `--sunken` with a `--muted` legend. The picker uses the same component as Remap. Inspector line: `Layer 0 · row 1, col 3`.
- Results (`Imported keymap.json · 12 keys written`, `Couldn't write: …`, `Keymap reset to defaults`) go in a result line under the card header, not in the header.

---

## 8. Copy: final strings for the reported leaks

| Where | Current | Final |
|---|---|---|
| Remap matched line | `Matched: telink-rover-84-v3-, telink-rover-84-v3--keyboard` | `Found: Rover 84 V3 (2 inputs)` + `<details>` `Show input names` |
| Remap device field | `Apply to keyboards whose name contains` | `Keyboard name contains` + helper `Matched against the input names Hyprland reports.` |
| Remap swap | `Swap Alt and Super Use this when…` (one line) | Label `Swap Alt and Super`. Helper: `Turn on when the keyboard is in Mac mode (the Win key acts as Alt). Turn off in Windows mode, or the keys swap twice. Stays on when you turn off the remap.` |
| Remap revert | `Revert to default` | `Turn off remap` |
| Remap apply | `Apply (0)` | see table 5.3 (`Apply 1 change`, `Applied`, `Turn on remap`) |
| Remap listen | `Listen to keyboard` / `Listening… (click to stop)` | `Listen` / `Press a key…` |
| Remap clear | `Clear mapping` | `Reset this key` |
| Remap modifier status | `LCtrl is a modifier; remapping modifiers is not supported yet.` | inspector text in 5.6 |
| Remap board caption | `Layout is approximate. If a key is missing or misplaced, use Listen…` | `Drawing is approximate. If a key is missing or in the wrong place, use Listen and press it.` |
| Remap h1 | `Keyboard Remap` | `Key remap` |
| Lighting speed | `Which end is faster is not confirmed.` | `Only affects animated modes. It isn't confirmed yet whether higher means faster or slower.` |
| Lighting mode hint | `Only Static has been confirmed on this keyboard. Other modes are sent as-is…` | optgroups + helper in 6.4 |
| Lighting status | `Written to the keyboard and verified` (header only) | `Written and verified.` in the result line next to Apply |
| Lighting apply | `Apply again` | `Write again` (secondary) |
| Lighting read | `Read from keyboard` (meaning in tooltip) | `Re-read keyboard` + visible caption |
| Lighting swatches | `aria-label="Color #ff0000"` | `Red`, `Orange`, … (4.5) |
| Lighting not found | `The Rover 84 vendor interface was not found or cannot be opened.` | banner in 6.7 |
| Lighting h1 | `Keyboard Lighting` | `Lighting` |
| VIA empty | `Connect the mock device to start editing a keymap.` | `For keyboards with VIA firmware` + body in section 7 |
| VIA buttons | `Mock device` / `Connect keyboard` | `Try a demo keyboard` / `Connect a VIA keyboard` |
| VIA h1 | `Keyboard Config · VIA` | `VIA editor` |
| All pages, header links | `Lighting →`, `← Key remap`, `← OS remap`, `VIA keyboards →` | shared nav: `Key remap`, `Lighting`, `VIA editor` |
| Page `<title>` | `Keyboard Remap`, `Keyboard Lighting`, `Keyboard Config - VIA` | `Key remap · keyboard-config`, `Lighting · keyboard-config`, `VIA editor · keyboard-config` |

---

## 9. Implementation notes for `el()` and re-rendering

1. **Focus restore [behaviour].** Each `render()` replaces the whole subtree, so focus falls to `<body>` after every click. Keyboard use is broken today. Fix: give every interactive element a stable `data-fid` (for example `key-CapsLock`, `tab-Letters`, `apply`). In `render()`, read `document.activeElement?.getAttribute("data-fid")` before `replaceChildren` and focus the same fid afterwards with `{ preventScroll: true }`. This replaces the special-case `keepSearchFocus`, but keep the caret-position logic for the search field.
2. **Attributes.** `el()` uses `Object.assign`, so set `aria-*`, `role`, `data-*` and `for` through `setAttribute`. Alternatively, add an optional `attrs` argument to `el()`; that is a tiny change with no dependency. `htmlFor` works as a property.
3. **Labels.** Every `<input>` and `<select>` gets an `id` and a real `<label for>`. Delete `aria-label` where a visible label exists. Helpers are linked with `aria-describedby`.
4. **Live regions** persist outside `#app` (section 3). Write feedback to them as well as to the visible result line.
5. **No inline pixel geometry.** Board positions use `--x`, `--y` and `--w` only (4.4). Delete `UNIT` from `src/remap/main.ts` and `src/main.ts`.
6. Utility: `.sr-only` (the standard visually-hidden pattern). Skip link: `.skip`, visible on `:focus`.

---

## 10. Implementation order (smallest safe steps)

Each step is shippable on its own. Check it in the browser before moving on.

1. **Tokens and base.** Swap in the `:root` block (section 2), the type roles, `:focus-visible`, the disabled rule (no opacity), the 44px button height and the reduced-motion block. CSS only; no JS changes.
2. **Render infrastructure.** Focus restore (9.1), labels and `for`/`id` (9.3), persistent live regions (9.4). Small JS change in all three pages; the UI looks the same.
3. **Shell.** `src/ui/shell.ts` with header, nav and `aria-current`, chip, banner slot and skip link. Remove the per-page link rows and the `.status` line. Update the three `<title>`s.
4. **Component CSS.** Switch, segmented tabs, stepped slider, swatch, badge, banner, card, confirm-inline, apply bar (section 4).
5. **Shared board.** `src/ui/board.ts` with CSS-variable geometry, full-unit hit area, cap states and an interactive/preview mode. Wire it into Remap and VIA first, with no state changes yet.
6. **Remap.** Settings card, pending-count model (5.3), apply bar, inspector, locked/mapped/pending caps, one-shot Listen (5.4), swap-aware board (5.5), banners and copy (5.8).
7. **Lighting.** Preview (6.3), grouped modes (6.4), stepped sliders and switch (6.5), action placement and Restore card (6.6), states and copy (6.7).
8. **VIA.** Empty state, renamed buttons, connected layout, confirm on Reset (section 7).
9. **Copy pass and checklist.** Go through the section 8 table, then the section 11 checklist on all three pages in both themes.

---

## 11. Acceptance checklist (browser-verifiable)

Run each item on `/`, `/rgb.html` and `/via.html` unless noted, in light **and** dark (DevTools → Rendering → `prefers-color-scheme`).

**Targets and layout**
- [ ] No interactive element is under 44px tall. Paste into the console:
  `[...document.querySelectorAll('button,a[href],input:not([type=hidden]),select,summary')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height<44&&!e.closest('p')}).map(e=>e.outerHTML.slice(0,80))` → `[]`
- [ ] At 360px wide, `document.documentElement.scrollWidth <= innerWidth` is `true`. Only `.board-wrap` on Remap and VIA may scroll sideways.
- [ ] At 768px, the Remap board fits without a horizontal scrollbar.
- [ ] At 1280×800, the Remap board and the picker are both visible without scrolling the page.
- [ ] The Lighting preview never scrolls sideways at any width.
- [ ] Sibling cards have equal padding (inspect: 16px below 768, 24px from 768). No child of a card body has a `margin`.

**Keyboard and focus**
- [ ] Tab order on Remap: skip link → Key remap → Lighting → VIA editor → device name → Swap switch → Show input names → Listen → board keys (row by row) → Reset this key → search → category tabs → picker items → Turn off remap → Apply.
- [ ] Tab order on Lighting: skip link → nav (3) → Re-read keyboard → Mode → swatches (9) → Custom → Brightness → Speed → Random colors → Restore original → Turn lights off → Apply.
- [ ] Clicking any button with the mouse, then pressing Tab, moves to the **next** control, not back to the top (focus restore works).
- [ ] Listen: press Listen, press `Tab`. Tab is captured as a key selection, Listen turns off, and the next Tab moves focus normally (no trap).
- [ ] Every focused element shows a visible 2px cobalt ring, including keycaps, swatches, the switch and the range inputs.
- [ ] Confirm-inline: opening it focuses Cancel, Esc closes it, and focus returns to the trigger.
- [ ] The current page's nav link has `aria-current="page"` (check in the Elements panel).

**A11y**
- [ ] axe DevTools: 0 serious or critical issues, in both themes.
- [ ] Every input and select has a `<label for>`. `document.querySelectorAll('input:not([type=hidden]):not([id]),select:not([id])').length === 0`.
- [ ] Locked keys have no `opacity` below 1 (`getComputedStyle(key).opacity === "1"`).
- [ ] Emulate reduced motion: computed `transition-duration` on the switch thumb is `0s`.
- [ ] With a screen reader or the Accessibility tree: Apply on Remap announces "Applied to Rover 84 V3 (2 inputs)." in the live region.

**Remap behaviour**
- [ ] Only the swap toggled → summary `1 change not applied: Alt/Super swap`, button `Apply 1 change`.
- [ ] After Apply, with nothing pending → `Applied` (disabled) and `Remap is on. Everything is applied.`
- [ ] A remapped key shows its target legend on a cobalt-tint cap. A pending change also shows the amber corner square.
- [ ] Selecting Left Ctrl shows the "can't be remapped" explanation in the inspector, without hovering.
- [ ] With the swap on, Listen plus pressing the physical key printed Win selects the cap at the Win position (verify on the hardware in Mac mode).
- [ ] The Found line shows `Rover 84 V3 (2 inputs)`. The raw names appear only inside `Show input names`.

**Lighting behaviour**
- [ ] Changing the color or brightness re-tints every cap in the preview. Brightness Off leaves all caps at `--cap-off`.
- [ ] The Mode select shows the `Tested on this keyboard` and `Untested` groups. An untested mode shows the `Untested` badge.
- [ ] With Static selected, Speed is disabled and its reason is visible.
- [ ] Restore original is in its own card, not in the apply bar.
- [ ] Unplug the keyboard and press Re-read: the "Can't open the Rover 84" banner appears with Try again, and the controls are hidden.

**Visual restraint**
- [ ] Cobalt appears only on: the primary button, the focus ring, selected and remapped keys, switch-on, inline links, and the Listen-on outline. Search the CSS for `var(--accent` and justify each use.
- [ ] No `linear-gradient`, `radial-gradient`, `text-shadow` or glow `box-shadow` in `style.css`.
- [ ] No emoji characters in the UI (`/\p{Extended_Pictographic}/u.test(document.body.innerText) === false`).

---

## 12. Open questions (not blockers)

- Right Alt under Mac mode: does the Rover send `AltRight` or `MetaRight`? This decides the right-hand swapped legend (5.5). Check with Listen.
- Speed direction: once confirmed on the hardware, change the speed ticks to `Slow … Fast` and drop the helper sentence.
- A "what is my keyboard doing now" overview across pages (from the ux-flow report) is **out of scope** here. Each page's chip covers its own subsystem only.
