import { createTypeSpecLibrary } from "@typespec/compiler";

export const $lib = createTypeSpecLibrary({
  name: "just-the-type",
  diagnostics: {},
  state: {
    async: {
      description: "Operations and interfaces whose return types are wrapped in Promise",
    },
    readonly: { description: "Properties and models emitted with the readonly modifier" },
    tsType: { description: "Raw TypeScript type overrides with optional import source" },
    literalUnion: { description: "Enums emitted as unions of literals instead of TS enums" },
  },
});
