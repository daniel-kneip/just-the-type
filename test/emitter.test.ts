import { createTestHost } from "@typespec/compiler/testing";
import { describe, expect, it } from "vitest";
import { $decorators } from "../src/decorators.js";
import { emitTypes } from "../src/emitter.js";

async function emit(code: string): Promise<string> {
  const host = await createTestHost();
  host.addJsFile("jtt.js", { $decorators });
  host.addTypeSpecFile("main.tsp", `import "./jtt.js";\nusing JustTheType;\n${code}`);
  await host.compile("main.tsp");
  return emitTypes(host.program);
}

describe("emitTypes", () => {
  it("emits a model as an interface", async () => {
    const result = await emit(`
      model Pet {
        name: string;
        age: int32;
        tags?: string[];
      }
    `);
    expect(result).toBe(
      [
        "export interface Pet {",
        "    name: string;",
        "    age: number;",
        "    tags?: string[];",
        "}",
        "",
      ].join("\n"),
    );
  });

  it("emits model inheritance as extends", async () => {
    const result = await emit(`
      model Animal { kind: string; }
      model Dog extends Animal { breed: string; }
    `);
    expect(result).toContain("export interface Dog extends Animal {");
  });

  it("emits enums", async () => {
    const result = await emit(`
      enum Color { Red: "red", Blue: "blue" }
      enum Size { Small, Large }
    `);
    expect(result).toContain('Red = "red"');
    expect(result).toContain('Small = "Small"');
  });

  it("emits named unions as type aliases", async () => {
    const result = await emit(`
      union Result { ok: string, code: int32 }
    `);
    expect(result).toContain("export type Result = string | number;");
  });

  it("handles anonymous models, unions and literals inline", async () => {
    const result = await emit(`
      model Widget {
        state: "on" | "off";
        nested: { deep: boolean };
        count: 42 | int64;
      }
    `);
    expect(result).toContain('state: "on" | "off";');
    expect(result).toContain("nested: {");
    expect(result).toContain("deep: boolean;");
    expect(result).toContain("count: 42 | bigint;");
  });

  it("maps well-known scalars", async () => {
    const result = await emit(`
      model Times {
        at: utcDateTime;
        blob: bytes;
        site: url;
        anything: unknown;
        nothing: null;
      }
    `);
    expect(result).toContain("at: string;");
    expect(result).toContain("blob: Uint8Array;");
    expect(result).toContain("site: string;");
    expect(result).toContain("anything: unknown;");
    expect(result).toContain("nothing: null;");
  });

  it("declares custom scalars as type aliases", async () => {
    const result = await emit(`
      scalar petId extends int32;
      scalar trackingId extends petId;
      model Pet { id: petId; tracking: trackingId; }
    `);
    expect(result).toContain("export type petId = number;");
    expect(result).toContain("export type trackingId = petId;");
    expect(result).toContain("id: petId;");
  });

  it("emits Record and tuple types", async () => {
    const result = await emit(`
      model Bag {
        meta: Record<string>;
        pair: [string, int32];
      }
    `);
    expect(result).toContain("meta: Record<string, string>;");
    expect(result).toContain("pair: [string, number];");
  });

  it("emits templates as generics and instantiations as references", async () => {
    const result = await emit(`
      model Wrapper<T> { value: T; }
      model Box { wrapped: Wrapper<string>; }
    `);
    expect(result).toContain("export interface Wrapper<T> {");
    expect(result).toContain("value: T;");
    expect(result).toContain("wrapped: Wrapper<string>;");
  });

  it("emits arrays and records of template parameters inside generics", async () => {
    const result = await emit(`
      model Page<T> {
        items: T[];
        index: Record<T>;
      }
    `);
    expect(result).toContain("items: T[];");
    expect(result).toContain("index: Record<string, T>;");
  });

  it("emits template constraints and defaults", async () => {
    const result = await emit(`
      model Page<T extends string = string> { item: T; }
    `);
    expect(result).toContain("export interface Page<T extends string = string> {");
  });

  it("inlines instantiations of templates with valueof parameters", async () => {
    const result = await emit(`
      model Tagged<T, Tag extends valueof string> { value: T; }
      model Use { t: Tagged<int32, "x">; }
    `);
    expect(result).not.toContain("interface Tagged");
    expect(result).toContain("t: {");
    expect(result).toContain("value: number;");
  });

  it("emits operations as function type aliases", async () => {
    const result = await emit(`
      model Pet { name: string; }
      op getPet(id: string, verbose?: boolean): Pet;
    `);
    expect(result).toContain("export type getPet = (id: string, verbose?: boolean) => Pet;");
  });

  it("resolves op is reuse and skips templated op declarations", async () => {
    const result = await emit(`
      op ReadOp<T>(id: string): T;
      op readPet is ReadOp<string>;
    `);
    expect(result).toContain("export type readPet = (id: string) => string;");
    expect(result).not.toContain("ReadOp");
  });

  it("emits TypeSpec interfaces as TypeScript interfaces", async () => {
    const result = await emit(`
      model Pet { name: string; }
      interface Pets {
        get(id: string): Pet;
        list(): Pet[];
      }
    `);
    expect(result).toContain("export interface Pets {");
    expect(result).toContain("get(id: string): Pet;");
    expect(result).toContain("list(): Pet[];");
  });

  it("emits Record spreads as index signatures", async () => {
    const result = await emit(`
      model Extra {
        name: string;
        ...Record<string>;
      }
    `);
    expect(result).toContain("[key: string]: string;");
    expect(result).toContain("name: string;");
  });

  it("emits named array models as type aliases", async () => {
    const result = await emit(`
      model Pet { name: string; }
      model Pets is Pet[];
    `);
    expect(result).toContain("export type Pets = Pet[];");
  });

  it("emits string templates as template literal types", async () => {
    const result = await emit(`
      model Link { href: "https://\${string}/pets/\${int32}"; }
    `);
    expect(result).toContain("href: `https://${string}/pets/${number}`;");
  });

  it("emits doc comments as JSDoc", async () => {
    const result = await emit(`
      /** A pet in the store. */
      model Pet {
        /** The pet's name. */
        name: string;
      }
    `);
    expect(result).toContain("/** A pet in the store. */");
    expect(result).toContain("/** The pet's name. */");
  });

  it("inlines intersections as merged anonymous models", async () => {
    const result = await emit(`
      model A { a: string; }
      model B { b: int32; }
      model C { both: A & B; }
    `);
    expect(result).toContain("both: {");
    expect(result).toContain("a: string;");
    expect(result).toContain("b: number;");
  });

  it("resolves enum spread", async () => {
    const result = await emit(`
      enum Base { A: "a" }
      enum Ext { ...Base, B: "b" }
    `);
    expect(result).toContain("export enum Ext {");
    expect(result).toContain('A = "a"');
    expect(result).toContain('B = "b"');
  });

  it("wraps @promise operation returns in Promise", async () => {
    const result = await emit(`
      @promise op getName(id: string): string;
    `);
    expect(result).toContain("export type getName = (id: string) => Promise<string>;");
  });

  it("wraps all operations of an @promise interface in Promise", async () => {
    const result = await emit(`
      @promise interface Store {
        get(id: string): string;
        count(): int32;
      }
    `);
    expect(result).toContain("get(id: string): Promise<string>;");
    expect(result).toContain("count(): Promise<number>;");
  });

  it("emits @readonly properties and models", async () => {
    const result = await emit(`
      model Pet {
        @readonly id: string;
        name: string;
      }
      @readonly model Frozen {
        value: string;
      }
    `);
    expect(result).toContain("readonly id: string;");
    expect(result).toContain("name: string;");
    expect(result).not.toContain("readonly name");
    expect(result).toContain("readonly value: string;");
  });

  it("overrides property types with @tsType", async () => {
    const result = await emit(`
      model Event {
        @tsType("Date") at: utcDateTime;
      }
    `);
    expect(result).toContain("at: Date;");
    expect(result).not.toContain("import");
  });

  it("adds type imports for @tsType with a module", async () => {
    const result = await emit(`
      @tsType("Dayjs", "dayjs")
      scalar timestamp extends utcDateTime;
      model Event { at: timestamp; }
    `);
    expect(result).toContain('import type { Dayjs } from "dayjs";');
    expect(result).toContain("export type timestamp = Dayjs;");
    expect(result).toContain("at: timestamp;");
  });

  it("imports the root identifier for qualified @tsType overrides", async () => {
    const result = await emit(`
      model Event {
        @tsType("Temporal.Instant", "@js-temporal/polyfill") at: utcDateTime;
      }
    `);
    expect(result).toContain('import type { Temporal } from "@js-temporal/polyfill";');
    expect(result).toContain("at: Temporal.Instant;");
  });

  it("augments std scalars with @@tsType", async () => {
    const result = await emit(`
      @@tsType(utcDateTime, "Date");
      model Event { at: utcDateTime; }
    `);
    expect(result).toContain("at: Date;");
  });

  it("emits @literalUnion enums as literal unions", async () => {
    const result = await emit(`
      @literalUnion enum Color { Red: "red", Blue: "blue" }
      model Paint {
        color: Color;
        tone: Color.Red;
      }
    `);
    expect(result).toContain('export type Color = "red" | "blue";');
    expect(result).not.toContain("enum Color");
    expect(result).toContain("color: Color;");
    expect(result).toContain('tone: "red";');
  });

  it("emits generic unions", async () => {
    const result = await emit(`
      union Maybe<T> { value: T, nothing: null }
      model M { x: Maybe<string>; }
    `);
    expect(result).toContain("export type Maybe<T> = T | null;");
    expect(result).toContain("x: Maybe<string>;");
  });

  it("walks user namespaces but skips the TypeSpec stdlib", async () => {
    const result = await emit(`
      namespace My.Service;
      model Thing { id: string; }
    `);
    expect(result).toContain("export interface Thing {");
    expect(result).not.toContain("interface ServiceOptions");
  });

  it("references enum members as types", async () => {
    const result = await emit(`
      enum Color { Red: "red", Blue: "blue" }
      model Paint { tone: Color.Red; }
    `);
    expect(result).toContain("tone: Color.Red;");
  });
});
