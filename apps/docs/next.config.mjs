import { createMDX } from "fumadocs-mdx/next";
import path from "node:path";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  output: "export",
  turbopack: {
    root: path.resolve(import.meta.dirname, "../.."),
  },
  webpack: (webpackConfig) => {
    // React Three Fiber 10 feature-detects `React.Activity` (React 19.2+), which the React canary
    // vendored by Next 15 does not export. Webpack's strict ESM check flags the guarded access in
    // R3F's .mjs build as a missing export, so downgrade that check for R3F's dist only.
    webpackConfig.module.rules.push({
      test: /[\\/]@react-three[\\/]fiber[\\/]dist[\\/]/,
      parser: { exportsPresence: "warn" },
    });
    return webpackConfig;
  },
};

export default withMDX(config);
