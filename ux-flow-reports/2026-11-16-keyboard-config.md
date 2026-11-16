# UX flow review — keyboard-config — 2026-11-16

## Purpose
Master is trying to make one specific keyboard (PressPlay Rover 84 V3) behave and look the way they want on Hyprland: remap keys, fix the Alt/Super swap, and set the backlight.

## Pages and their single job
- `/` Remap: change what keys type, and fix Alt/Super.
- `/rgb.html` Lighting: set backlight mode, color, brightness, speed.
- `/via.html` VIA: edit keymaps on QMK/VIA boards. Does not apply to this keyboard.

## States covered vs missing

| State | Remap | Lighting | Notes |
|---|---|---|---|
| Loading | text in header only | text in header only | no skeleton; page looks empty for a moment |
| Server down | status line error, empty page | same | no retry, no explanation of how to start the server |
| Keyboard not plugged / no permission | "no keyboard matches" | card with retry | good on Lighting; Remap has no equivalent card |
| Hyprland unreachable | warning in status | n/a | easy to miss |
| Unrecognized record | n/a | warning card, writes disabled | good |
| Write success | status text | status text | no visible confirmation near the button |
| Write failed | red status text | red status text | far from the action that failed |
| Keyboard changed under the app (Fn keys) | n/a | fixed: re-read on focus | added today |
| Nothing to apply | `Apply (0)` | "Apply again" | wording is confusing in both |

## Affordance vs state mismatches
1. Remap: `Apply (0)` is enabled-looking while a swap change is pending; the count ignores the swap.
2. Remap: picker buttons are disabled with no reason until a key is selected, and the picker is below the fold.
3. Remap: locked modifier keys look disabled but say why only in a tooltip.
4. Remap: after turning the swap on, the board still labels the keys with their old names.
5. Lighting: all 18 modes look equally valid; only Static is proven. Speed and Random colors have no confirmed meaning.
6. Lighting: "Turn lights off" and "Apply" sit together with the destructive "Restore original" on the same row.
7. VIA: "Connect keyboard" and "Mock device" are primary buttons, but neither helps Master's keyboard.

## Copy leaks
| Where | Current | Proposed |
|---|---|---|
| Remap matched line | "Matched: telink-rover-84-v3-, telink-rover-84-v3--keyboard" | "Found: Rover 84 V3 (2 inputs)" |
| Remap swap | "Swap Alt and Super Use this when…" (runs together) | label + separate helper text |
| Lighting speed | "Which end is faster is not confirmed." | "Speed: Slow ... Fast" once verified, else hide |
| Lighting status | "Written to the keyboard and verified" | keep, but also show it next to the button |
| Remap | "Revert to default" | "Turn off remap" (it also keeps the Alt/Super swap) |
| VIA | "Connect the mock device to start editing a keymap." | "This tool is for keyboards with VIA firmware. Your Rover 84 does not use it." |

## Flow gaps
- **Dead ends:** server down shows an empty shell with no next step. VIA empty state points only at a mock.
- **Three tools, no map:** nothing tells Master the order (fix Alt/Super first, then remap, then lighting) or where each setting lives.
- **No "what is my keyboard doing now" overview.** The state of swap, remap and lighting is spread over three pages.
- **Entry assumption:** Master opens the app after fixing something in Hyprland; the first screen is the remap board, not their current problem.

## Prioritized fixes
| P | Issue | Fix |
|---|---|---|
| P0 | Alt/Super swap is a setting, not a mapping, but lives inside the mapping card | Separate "Keyboard settings" card, Apply count includes it |
| P0 | Server-down and Hyprland-down give a blank page | One shared connection banner with retry and the start command |
| P1 | No shared navigation | Common header with the three tools and the current one marked |
| P1 | Lighting has no real picture of the result | Draw the keyboard and tint keys with the chosen color and brightness |
| P1 | Unverified modes presented as normal | Group "Verified" vs "Experimental" |
| P2 | Touch targets under 44px | Raise button, swatch and slider sizes |
| P2 | VIA leads with mock | Make VIA a secondary entry, explain who it is for |
