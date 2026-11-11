// docker/como-tu.mjs — lanza la orden (npm install, Vite…) con TU usuario, el dueño de la carpeta del
// proyecto, y no como root. Así los ficheros que se crean (node_modules…) son tuyos y nunca sale «EACCES»,
// tenga tu usuario el número que tenga en el ordenador. No hace falta tocarlo.
/* global process */
import { statSync } from "node:fs";
import { spawnSync } from "node:child_process";

const [orden, ...args] = process.argv.slice(2);
const { uid, gid } = statSync("/app");
const r = spawnSync(orden, args, { stdio: "inherit", uid, gid, env: { ...process.env, HOME: "/tmp" } });
if (r.error) process.stderr.write(`${r.error.message}\n`);
process.exit(r.status ?? 1);
