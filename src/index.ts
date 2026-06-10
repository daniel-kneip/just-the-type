import { EmitContext, emitFile, resolvePath } from "@typespec/compiler";
import { emitTypes } from "./emitter.js";

export { $decorators } from "./decorators.js";
export { emitTypes } from "./emitter.js";
export { $lib } from "./lib.js";

export async function $onEmit(context: EmitContext): Promise<void> {
  if (context.program.compilerOptions.noEmit) return;
  await emitFile(context.program, {
    path: resolvePath(context.emitterOutputDir, "types.ts"),
    content: emitTypes(context.program),
  });
}
