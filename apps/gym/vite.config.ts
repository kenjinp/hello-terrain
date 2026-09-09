import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: Object.fromEntries(
      ["three", "react", "work"].map((name) => [
        `@hello-terrain/${name}`,
        fileURLToPath(
          new URL(
            `../../packages/${name}/src/index.${name === "react" ? "tsx" : "ts"}`,
            import.meta.url,
          ),
        ),
      ]),
    ),
    dedupe: ["react", "react-dom", "three", "@react-three/fiber"],
  },
  esbuild: { jsx: "automatic" },
  build: { sourcemap: true },
});
