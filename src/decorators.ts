import {
  DecoratorContext,
  Enum,
  Interface,
  Model,
  ModelProperty,
  Operation,
  Program,
  Scalar,
  Type,
} from "@typespec/compiler";
import { $lib } from "./lib.js";

const keys = $lib.stateKeys;

export interface TsTypeOverride {
  type: string;
  from?: string;
}

// Decorator arguments declared as `valueof string` arrive as plain strings;
// without the extern declaration (e.g. in tests) they arrive as StringLiteral types.
function asString(value: string | { value: string }): string;
function asString(value: string | { value: string } | undefined): string | undefined;
function asString(value: string | { value: string } | undefined): string | undefined {
  return typeof value === "object" ? value.value : value;
}

function $promise(context: DecoratorContext, target: Operation | Interface): void {
  context.program.stateSet(keys.async).add(target);
}

function $readonly(context: DecoratorContext, target: ModelProperty | Model): void {
  context.program.stateSet(keys.readonly).add(target);
}

function $tsType(
  context: DecoratorContext,
  target: Scalar | ModelProperty,
  type: string,
  importFrom?: string,
): void {
  context.program.stateMap(keys.tsType).set(target, {
    type: asString(type),
    from: asString(importFrom),
  } satisfies TsTypeOverride);
}

function $literalUnion(context: DecoratorContext, target: Enum): void {
  context.program.stateSet(keys.literalUnion).add(target);
}

export const $decorators = {
  JustTheType: {
    promise: $promise,
    readonly: $readonly,
    tsType: $tsType,
    literalUnion: $literalUnion,
  },
};

export function isAsync(program: Program, type: Type): boolean {
  return program.stateSet(keys.async).has(type);
}

export function isReadonly(program: Program, type: Type): boolean {
  return program.stateSet(keys.readonly).has(type);
}

export function getTsType(program: Program, type: Type): TsTypeOverride | undefined {
  return program.stateMap(keys.tsType).get(type) as TsTypeOverride | undefined;
}

export function isLiteralUnion(program: Program, type: Type): boolean {
  return program.stateSet(keys.literalUnion).has(type);
}
