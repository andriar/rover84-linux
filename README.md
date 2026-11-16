# rover84-linux

Unofficial tools for the PressPlay Rover 84 V3 keyboard on Linux (Hyprland): key remap, backlight control, and a generic VIA editor. Not affiliated with PressPlay or Evision. The lighting protocol was worked out by reading the vendor's Windows app (static analysis only, never run) and testing on one keyboard. It writes to the keyboard's own settings, so use it at your own risk; the app backs up the original record first.

Keyboard and mouse tools in one repo.

| Page | For | How |
|---|---|---|
| `/` OS-level remap | Any keyboard on Hyprland, including boards with no VIA/QMK (built for the PressPlay Rover 84 V3, Evision `320f:5055`) | Generates an xkb layout and applies it per device with `hyprctl eval` |
| `/rgb.html` Backlight | PressPlay Rover 84 V3 (Evision `320f:5055`), wired | Raw HID to the vendor interface (usage page `0xFF1C`). Reads and writes one 21-byte lighting record, read back after every write |
| `/mouse.html` Mouse | Any mouse on Hyprland (built for the PressPlay Nova V3 dongle, `248a:fb01`) | Pointer speed, acceleration, scroll speed, natural scroll and left-handed, applied per device with `hl.device`. Does not talk to the mouse itself, so no DPI or lighting yet |
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

## Alt/Super swap (Mac-mode keyboards)

If the keyboard is in Mac mode its firmware already swaps Alt and Win, so Super shortcuts stop working. Tick **Swap Alt and Super** on the remap page and Apply: it adds `kb_options = "altwin:swap_alt_win"` for the matched devices, also when you revert the key mappings. Untick it if you switch the keyboard back to Windows mode, or the keys swap twice.

## Make it survive `hyprctl reload`

Hyprland 0.56 uses `hyprland.lua`. A reload re-reads it and resets per-device settings, so add this block
(for example after the INPUT section). The guard means a missing or broken file never breaks the config:

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

## Gotchas

- `hyprctl eval` treats an argument starting with `--` as a flag. Never send Lua comments to it.
- `server/` and `src/remap/` are loaded by Node's type stripping: no enums or parameter properties, and relative imports end in `.ts`. `npm run typecheck` enforces this with `erasableSyntaxOnly`.

## Mouse (`/mouse.html`)

Settings are written as a marked block at the end of the same `~/.config/keyboard-config/hyprland.lua` (`-- keyboard-config:mouse begin ... end`), so the remap and the mouse share one `dofile`. Each page rewrites only its own part. "Use defaults" removes the block and puts the device back on your global `input` values, read live from Hyprland. Your chosen values stay in `mouse.json` for next time.

**Verified:** apply and reset on the real mouse (scroll speed read back from `hyprctl devices`), and that Hyprland rejects unknown option names. **Not verified:** pointer speed, acceleration, natural scroll and left-handed by feel, since `hyprctl devices` only reports scroll speed per mouse. **Not built:** DPI, polling rate and lighting, which live in the mouse and need its vendor protocol. The mouse exposes one HID interface with a 32-byte report 5 that may carry it, untested.

## Lighting (`/rgb.html`)

Needs read/write access to the keyboard's `hidraw` node. One-time udev rule (needs root):

```
printf '%s\n' 'KERNEL=="hidraw*", ATTRS{idVendor}=="320f", ATTRS{idProduct}=="5055", TAG+="uaccess"' | sudo tee /etc/udev/rules.d/70-rover84.rules
sudo udevadm control --reload && sudo udevadm trigger
```

Then replug the keyboard. Protocol (64-byte reports, byte 0 = 4): `Begin` (cmd 1), `Read` (5) / `Write` (6) with length and 16-bit offset, `End` (2); checksum is the unsigned sum of bytes 3..63, little-endian at bytes 1-2. The lighting record is 21 bytes at offset 0: byte 1 mode, 2 brightness 0-4, 3 speed, 5 multicolor flag, 6-8 RGB. Other bytes are preserved on write.

Safety: nothing is written until you press Apply. The app refuses to write when the stored record does not look like a lighting record, saves the original record once to `~/.config/keyboard-config/rgb-backup.json`, and **Restore original** writes it back.

**Verified on the real keyboard:** read, write and read-back; Static mode with a red color lit the keys. **Not verified:** every other mode, speed direction, the multicolor flag, record bytes 0 and 4, and whether the setting survives a power cycle.

## License

MIT. See `LICENSE`.
