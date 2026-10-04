import { defineConfig } from "oxlint"
import antiSlop from "ultracite/oxlint/anti-slop"
import core from "ultracite/oxlint/core"

import effect from "./oxlint.effect.ts"

export default defineConfig({
  extends: [core, antiSlop, effect],
  jsPlugins: ["ts-lint"],
  options: {
    typeAware: true,
    typeCheck: true,
  },
  rules: {
    complexity: ["error", 15],
    "max-classes-per-file": "off",
    "max-depth": ["error", { max: 3 }],
    "sort-keys": "off",
    "ts-lint/effect-fn-return-type": "error",
    "ts-lint/no-undefined": "error",
    "ts-lint/no-unknown": "warn",
    "unicorn/throw-new-error": "off",
  },
})
