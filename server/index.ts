import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHandler } from "./app.ts";

const HOST = "127.0.0.1";
const PORT = Number(process.env.KBCONFIG_PORT ?? 5174);
const home = homedir();
const configHome = process.env.XDG_CONFIG_HOME ?? join(home, ".config");
const dist = resolve(fileURLToPath(new URL("../dist", import.meta.url)));

const handler = createHandler({
  configDir: join(configHome, "keyboard-config"),
  xkbDir: join(configHome, "xkb"),
  ...(existsSync(dist) ? { staticDir: dist } : {}),
  // The Vite dev server (5173) proxies /api here and forwards its own Host, so allow both.
  allowedHosts: [`127.0.0.1:${PORT}`, `localhost:${PORT}`, "127.0.0.1:5173", "localhost:5173"],
  hyprctl: (args) =>
    new Promise((res, rej) => {
      execFile("hyprctl", args, { timeout: 3000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) =>
        err ? rej(new Error((stderr || stdout || err.message).trim())) : res(stdout),
      );
    }),
});

createServer((req, res) => void handler(req, res)).listen(PORT, HOST, () => {
  console.log(`keyboard-config listening on http://${HOST}:${PORT}${existsSync(dist) ? "" : " (API only; run `npm run dev` for the UI)"}`);
});
