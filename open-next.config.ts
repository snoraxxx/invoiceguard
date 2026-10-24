import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Every page reads live data from Postgres, so there is no incremental cache to configure.
export default defineCloudflareConfig();
