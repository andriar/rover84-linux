"""Compile an xkb layout with the real libxkbcommon and replay key presses.

stdin : {"xdg": str, "layout": str, "variant": str, "steps": [["down"|"up", evdev_keycode], ...]}
stdout: one JSON object per "down" step: {"sym": str, "mods": [str, ...]}
Same library Hyprland uses, so this checks real behavior without touching /dev/input.
"""
import ctypes
import ctypes.util
import json
import os
import sys

req = json.load(sys.stdin)
os.environ["XDG_CONFIG_HOME"] = req["xdg"]
os.environ.pop("XKB_CONFIG_ROOT", None)

lib = ctypes.CDLL(ctypes.util.find_library("xkbcommon") or "libxkbcommon.so.0")


class Names(ctypes.Structure):
    _fields_ = [(n, ctypes.c_char_p) for n in ("rules", "model", "layout", "variant", "options")]


lib.xkb_context_new.restype = ctypes.c_void_p
lib.xkb_keymap_new_from_names.restype = ctypes.c_void_p
lib.xkb_keymap_new_from_names.argtypes = [ctypes.c_void_p, ctypes.POINTER(Names), ctypes.c_int]
lib.xkb_state_new.restype = ctypes.c_void_p
lib.xkb_state_new.argtypes = [ctypes.c_void_p]
lib.xkb_state_update_key.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int]
lib.xkb_state_key_get_one_sym.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
lib.xkb_state_key_get_one_sym.restype = ctypes.c_uint32
lib.xkb_keysym_get_name.argtypes = [ctypes.c_uint32, ctypes.c_char_p, ctypes.c_size_t]
lib.xkb_state_mod_name_is_active.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int]

ctx = lib.xkb_context_new(0)
names = Names(b"evdev", b"pc105", req["layout"].encode(), req["variant"].encode(), b"")
keymap = lib.xkb_keymap_new_from_names(ctx, ctypes.byref(names), 0)
if not keymap:
    print(json.dumps({"error": "keymap failed to compile"}))
    sys.exit(2)
state = lib.xkb_state_new(keymap)

EFFECTIVE = 8
out = []
for action, evdev in req["steps"]:
    code = evdev + 8  # xkb keycodes are evdev + 8
    if action == "down":
        sym = lib.xkb_state_key_get_one_sym(state, code)
        buf = ctypes.create_string_buffer(64)
        lib.xkb_keysym_get_name(sym, buf, 64)
        lib.xkb_state_update_key(state, code, 1)
        mods = [m for m in ("Shift", "Lock", "Control", "Mod1", "Mod4") if lib.xkb_state_mod_name_is_active(state, m.encode(), EFFECTIVE) > 0]
        out.append({"sym": buf.value.decode(), "mods": mods})
    else:
        lib.xkb_state_update_key(state, code, 0)
print(json.dumps(out))
