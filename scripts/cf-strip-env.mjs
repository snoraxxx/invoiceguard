/**
 * OpenNext copies every .env* file into the worker bundle as fallback values. Empty them after
 * the build so local secrets (database password, OpenAI key) are never uploaded to Cloudflare —
 * the deployed worker gets its config from wrangler vars and secrets instead.
 */
import { writeFileSync } from "node:fs";

writeFileSync(
  ".open-next/cloudflare/next-env.mjs",
  ["production", "development", "test"].map((mode) => `export const ${mode} = {};\n`).join(""),
);
console.log("Stripped local .env values from the worker bundle.");
