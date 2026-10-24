/**
 * Turbopack links each server-external package from .next/node_modules into pnpm's store
 * (../../node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>). OpenNext turns that link target into
 * an import of ".pnpm/<pkg>@<ver>/...", which bypasses the package's `exports` map — so the
 * Worker gets postgres.js's Node build instead of its Cloudflare build, and TLS to the database
 * fails. Repoint the links at the top-level package so OpenNext imports it by its plain name.
 */
import { existsSync, lstatSync, readdirSync, readlinkSync, symlinkSync, unlinkSync } from "node:fs";
import path from "node:path";

for (const dir of [".next/node_modules", ".next/standalone/.next/node_modules"]) {
  if (existsSync(dir)) relink(dir);
}

function relink(dir) {
  for (const name of readdirSync(dir)) {
    const link = path.join(dir, name);
    if (!lstatSync(link).isSymbolicLink()) continue;
    const match = readlinkSync(link).match(/node_modules\/\.pnpm\/[^/]+\/node_modules\/(.+)$/);
    if (!match) continue;
    unlinkSync(link);
    symlinkSync(`../../node_modules/${match[1]}`, link);
    console.log(`Linked ${dir}/${name} -> node_modules/${match[1]}`);
  }
}
