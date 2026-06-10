# just-the-type

Emitter to create TypeScript types from TypeSpec. No clients, no runtime, no
serializers — just the types, built with the TypeScript compiler factory API.

## Usage

```sh
pnpm add just-the-type
tsp compile . --emit just-the-type
```

The emitter writes a single `types.ts` to `tsp-output/just-the-type/`.

## What gets emitted

| TypeSpec                                 | TypeScript                                     |
| ---------------------------------------- | ---------------------------------------------- |
| `model`                                  | `export interface` (with `extends`)            |
| `model Wrapper<T>` (constraints/defaults) | generic `export interface Wrapper<T>`          |
| `model Pets is Pet[]`                    | `export type Pets = Pet[]`                     |
| `...Record<T>` spread                    | index signature `[key: string]: T`             |
| `enum` (incl. spread)                    | `export enum`                                  |
| named `union` (incl. generic)            | `export type` alias                            |
| `op`                                     | `export type` function alias                   |
| `interface`                              | `export interface` with method signatures      |
| custom `scalar`                          | `export type` alias to its base primitive      |
| doc comments / `@doc`                    | JSDoc comments                                 |
| string templates `"a-${string}"`         | template literal types                         |
| anonymous models, unions, intersections  | inlined structurally                           |
| templates with `valueof` parameters      | declaration skipped, instantiations inlined    |
| `int64` / `uint64`                       | `bigint`                                       |
| other numerics                           | `number`                                       |
| `bytes`                                  | `Uint8Array`                                   |
| dates, times, `duration`, `url`          | `string`                                       |

Not represented in the output: `alias` declarations (dissolved by the TypeSpec
checker, their targets are inlined), values/`const`, and API-metadata decorators
such as `@visibility`, `@format`, or `@encode` that do not change the type shape.

## Decorators

The library ships decorators for TypeScript features that TypeSpec cannot
express. Import the library and bring them into scope:

```typespec
import "just-the-type";
using JustTheType;
```

| Decorator                       | Target                     | Effect                                                       |
| ------------------------------- | -------------------------- | ------------------------------------------------------------ |
| `@promise`                      | `op`, `interface`          | Wraps return types in `Promise<T>`                           |
| `@readonly`                     | property, `model`          | Emits the `readonly` modifier                                 |
| `@tsType("Date")`               | `scalar`, property         | Replaces the emitted type with raw TypeScript                 |
| `@tsType("Dayjs", "dayjs")`     | `scalar`, property         | Same, plus `import type { Dayjs } from "dayjs";`              |
| `@literalUnion`                 | `enum`                     | Emits `type Color = "red" \| "blue"` instead of a TS enum     |

`@tsType` also works on built-in scalars via augment decorators, e.g. map all
`utcDateTime` to real `Date` objects:

```typespec
@@tsType(utcDateTime, "Date");
```

For qualified overrides such as `@tsType("Temporal.Instant", "@js-temporal/polyfill")`
the root identifier (`Temporal`) is imported.

## Development

```sh
pnpm install
pnpm test        # vitest
pnpm build       # tsc -> dist/
```

Try it on the sample:

```sh
pnpm sample    # tsp compile sample -> sample/tsp-output/
```

## License

[MIT](LICENSE)
