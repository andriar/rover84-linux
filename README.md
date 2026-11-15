# keyboard-config

Two keyboard configurators in one repo.

| Page | For | How |
|---|---|---|
| `/` OS-level remap | Any keyboard on Hyprland, including boards with no VIA/QMK (built for the PressPlay Rover 84 V3, Evision `320f:5055`) | Generates an xkb layout and applies it per device with `hyprctl eval` |
| `/via.html` VIA editor | QMK keyboards with VIA enabled | WebHID raw-HID, 32-byte VIA packets. Tested against a mock and a fake HID device only |

## Run

```
npm install
npm start          # typecheck + build, then serves http://127.0.0.1:5174
npm run dev        # Vite UI on :5173, proxies /api to the server (run `npm run server` too)
npm test
```

The server listens on `127.0.0.1` only and rejects any `Host` or `Origin` that is not itself.

## How the OS-level remap works

1. The UI sends `{ deviceMatch, mappings }` to `POST /api/apply`.
2. The server writes `~/.config/xkb/symbols/kbconfig` (stock `us` plus one `replace key` per mapping).
3. It runs `hyprctl eval 'hl.device({ name = ..., kb_layout = "kbconfig", kb_variant = "rover" })'` for every keyboard whose name contains `deviceMatch`.
4. It also writes `~/.config/keyboard-config/hyprland.lua` with the same statements, so the remap can survive a reload.

## Make it survive `hyprctl reload`

Hyprland 0.56 uses `hyprland.lua`. A reload re-reads it and resets per-device settings, so add this block
(Master's config has it after the INPUT section). The guard means a missing or broken file never breaks the config:

```lua
do
    local path = os.getenv("HOME") .. "/.config/keyboard-config/hyprland.lua"
    local fh = io.open(path, "r")
    if fh then
        fh:close()
        pcall(dofile, path)
    end
end
```

## What was verified (2026-11-15, Hyprland 0.56.2)

| Check | Result |
|---|---|
| Generated xkb compiled with real libxkbcommon (`tests/xkb_probe.py`) | Caps to Ctrl is a true Control modifier, not Lock. Caps to Esc, letter swaps, F13 and media targets work |
| Live apply and revert on Hyprland | Only the matched devices change; other keyboards untouched |
| `dofile` guard: file absent, present, broken | `hyprctl eval` returns `ok` in all three, no config errors |
| Reload persistence, with a control | Applied remap stays `kbconfig` after `hyprctl reload`. With the file moved aside, a reload returns to `us`; restored, it returns to `kbconfig` |

**Not verified:** a physical key press. Nothing here reads `/dev/input`, so the end result on a real keystroke was only checked through libxkbcommon.

## Limits

- Modifier keys (Ctrl, Shift, Alt, Super) cannot be remapped away yet, except Caps Lock. xkb keeps a key's `modifier_map` even when its keysym changes.
- No tap-hold or layers; that needs `keyd` and root.
- The drawn layout is approximate. Use "Listen to keyboard" and press the key to select it.
- Lighting (RGB) is not handled. The Rover 84 uses Evision's vendor protocol, which is not documented.

## Gotchas

- `hyprctl eval` treats an argument starting with `--` as a flag. Never send Lua comments to it.
- `server/` and `src/remap/` are loaded by Node's type stripping: no enums or parameter properties, and relative imports end in `.ts`. `npm run typecheck` enforces this with `erasableSyntaxOnly`.
