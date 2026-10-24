import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type Database = ReturnType<typeof connect>;

function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
  // prepare: false keeps us compatible with Supabase's transaction pooler (port 6543), which
  // can't hold prepared statements across pooled connections.
  const client = postgres(url, { max: 5, prepare: false, idle_timeout: 20 });
  return drizzle(client, { schema });
}

/** The Cloudflare request context, or null when running under plain Node (next dev, scripts). */
function workerRequest(): object | null {
  try {
    return getCloudflareContext().ctx ?? null;
  } catch {
    return null;
  }
}

// Workers can't reuse a socket opened by another request, so each request gets its own client.
// Under Node a single pool is shared (and survives hot reloads in development).
const perRequest = new WeakMap<object, Database>();
const globalForDb = globalThis as unknown as { db?: Database };

function current(): Database {
  const ctx = workerRequest();
  if (!ctx) return (globalForDb.db ??= connect());
  let db = perRequest.get(ctx);
  if (!db) {
    db = connect();
    perRequest.set(ctx, db);
  }
  return db;
}

export const db = new Proxy({} as Database, {
  get(_, prop) {
    const target = current();
    const value = Reflect.get(target, prop, target);
    return typeof value === "function" ? value.bind(target) : value;
  },
});

export * from "./schema";
