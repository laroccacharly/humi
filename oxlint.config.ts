import { defineConfig } from "oxlint"
import tsLint from "ts-lint/config"
import antiSlop from "ultracite/oxlint/anti-slop"
import core from "ultracite/oxlint/core"

import foldkit from "./oxlint.foldkit.ts"

export default defineConfig({
  extends: [core, antiSlop, foldkit, tsLint],
  ignorePatterns: ["dist-ui/**"],
  options: {
    typeAware: true,
    typeCheck: true,
  },
  rules: {
    complexity: ["error", 15],
    "max-classes-per-file": "off",
    "max-depth": ["error", { max: 3 }],
    "sort-keys": "off",
    "unicorn/throw-new-error": "off",
  },
})
