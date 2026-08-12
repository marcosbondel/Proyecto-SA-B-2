# @bank/tooling

Shared build, lint, format and test configuration for the Bank USAC monorepo.
Configuration only — this package contains no runtime code, and nothing here
may be relaxed to make a build or lint run pass (FR-012).

| File | Consumed as |
| --- | --- |
| `tsconfig.base.json` | `"extends": "@bank/tooling/tsconfig.base.json"` |
| `eslint.base.mjs` | `import { serviceEslintConfig } from '@bank/tooling/eslint.base.mjs'` |
| `prettier.config.mjs` | `export { default } from '@bank/tooling/prettier.config.mjs'` |
| `jest.base.mjs` | `import { jestBaseConfig } from '@bank/tooling/jest.base.mjs'` |

`eslint.base.mjs` also carries the executable architecture rules: the layer
directions inside a service and the ban on importing another service's code
(FR-006, FR-007). A violation fails `pnpm lint`; it does not warn.

Dependency versions are not declared here as ranges — they come from the
`catalog` in `pnpm-workspace.yaml`.
