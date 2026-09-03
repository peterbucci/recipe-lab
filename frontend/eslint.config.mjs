import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["app/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}", "server/**/*.{ts,tsx}"],
    ignores: [
      "**/*.test.{ts,tsx}",
      "lib/api-transport/core.ts",
      "server/api-proxy.ts",
    ],
    rules: {
      "no-restricted-globals": [
        "error",
        {
          name: "fetch",
          message:
            "Production API calls must use the shared browser/server transport; only the executor and streaming proxy own raw fetch.",
        },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
