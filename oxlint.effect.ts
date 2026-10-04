import { fileURLToPath } from "node:url"

import { defineConfig } from "oxlint"

/**
 * Opt-in preset for the Effect architecture rules from dmmulroy/anti-slop.
 *
 * Upstream (https://github.com/dmmulroy/anti-slop) distributes TypeScript
 * sources only and is deliberately not published to npm, so it is pulled in
 * here as a pinned git dependency. The specifier points straight at the
 * installed source because the package `exports` map does not expose the
 * `src/effect` subpath.
 *
 * Oxlint loads these `.ts` plugin files with Node's type stripping, which
 * refuses files under `node_modules`
 * (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`). `lint` therefore runs with
 * Bun as the runtime (`bun --bun oxlint`), where stripping works.
 */
export default defineConfig({
  jsPlugins: [
    {
      name: "anti-slop-effect",
      specifier: fileURLToPath(
        new URL(
          "node_modules/oxlint-plugin-anti-slop/src/effect/index.ts",
          import.meta.url
        )
      ),
    },
  ],
  rules: {
    "anti-slop-effect/no-manual-effect-error-tag": "error",
    "anti-slop-effect/no-manual-tag-comparison": "error",
    "anti-slop-effect/no-manual-tagged-construction": "error",
    "anti-slop-effect/no-service-constructor-imports": "error",
    "anti-slop-effect/prefer-effect-match": "error",
  },
})
