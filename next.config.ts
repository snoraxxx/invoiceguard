import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Leave the Postgres driver unbundled so the Cloudflare build resolves its `workerd` export
  // (TLS over cloudflare:sockets) while Node keeps the regular build.
  serverExternalPackages: ["postgres"],
};

export default nextConfig;
