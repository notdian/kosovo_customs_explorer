import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

// https://vite.dev/config/
export default defineConfig({
  plugins: [preact(), tailwindcss()],
  base: process.env.NODE_ENV === "production" ? "/kosovo_customs_data/" : "/",
  resolve: {
    alias: {
      react: "preact/compat",
      "react-dom/test-utils": "preact/test-utils",
      "react-dom": "preact/compat", // Must be below test-utils
      "react/jsx-runtime": "preact/jsx-runtime",
      "@/data": path.resolve(projectRoot, "./data"),
      "@": path.resolve(projectRoot, "./src"),
    },
  },
  // Inject ISO build time as a constant we can read in the app
  define: {
    __BUILD_TIME__: JSON.stringify(
      new Date()
        .toISOString()
        .split("T")
        .join(" ")
        .replace(/\.[0-9]+Z/, "")
    ),
  },
});
