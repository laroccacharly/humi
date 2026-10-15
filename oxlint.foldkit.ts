import recommended from "@foldkit/oxlint-plugin/recommended.json" with { type: "json" }
import { defineConfig } from "oxlint"

const rules = Object.fromEntries(
  Object.entries(recommended.rules).map(
    ([rule, level]): [string, "error" | "off"] => [
      rule,
      level === "off" ? "off" : "error",
    ]
  )
)

/**
 * FoldKit's recommended rules, applied to the UI only. The UI also follows
 * FoldKit's conventions where they clash with the shared presets:
 * `Array<T>` / `ReadonlyArray<T>` generics, a Schema value and its type
 * sharing one name (`const Model` + `type Model`), and Effect's
 * `Effect.catch`, which the promise rules mistake for a Promise's.
 */
export default defineConfig({
  jsPlugins: recommended.jsPlugins,
  overrides: [
    {
      files: ["src/ui/**/*.ts"],
      rules: {
        ...rules,
        "no-redeclare": "off",
        "promise/prefer-await-to-callbacks": "off",
        "promise/prefer-await-to-then": "off",
        "typescript/array-type": ["error", { default: "generic" }],
      },
    },
  ],
})
