import {
  Enum,
  Interface,
  Model,
  Namespace,
  Operation,
  Program,
  Scalar,
  Union,
  isArrayModelType,
  isTemplateDeclaration,
} from "@typespec/compiler";
import ts from "typescript";
import { getTsType, isAsync, isLiteralUnion } from "./decorators.js";
import {
  Context,
  canEmitGeneric,
  inStdNamespace,
  literalNode,
  modelMembers,
  namedReference,
  overrideNode,
  propertyName,
  propertyTypeNode,
  stdScalarNode,
  typeParameterDeclarations,
  typeToNode,
  unionToNode,
  unknownType,
  withDoc,
} from "./type-nodes.js";

const f = ts.factory;

const exportModifier = () => [f.createModifier(ts.SyntaxKind.ExportKeyword)];

export function emitTypes(program: Program): string {
  const ctx: Context = { program, imports: new Map() };
  const statements: ts.Statement[] = [];
  collectNamespace(ctx, program.getGlobalNamespaceType(), statements);
  statements.unshift(...importDeclarations(ctx));
  const file = ts.createSourceFile("types.ts", "", ts.ScriptTarget.ES2022, false, ts.ScriptKind.TS);
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  return printer.printList(ts.ListFormat.MultiLine, f.createNodeArray(statements), file);
}

function importDeclarations(ctx: Context): ts.Statement[] {
  return [...ctx.imports].map(([module, names]) =>
    f.createImportDeclaration(
      undefined,
      // First arg is the phase modifier (ImportPhaseModifierSyntaxKind), not a
      // boolean — TypeKeyword emits `import type`. The boolean overload is deprecated.
      f.createImportClause(
        ts.SyntaxKind.TypeKeyword,
        undefined,
        f.createNamedImports(
          [...names]
            .sort()
            .map((name) => f.createImportSpecifier(false, undefined, f.createIdentifier(name))),
        ),
      ),
      f.createStringLiteral(module),
    ),
  );
}

function collectNamespace(ctx: Context, ns: Namespace, statements: ts.Statement[]): void {
  collectModels(ctx, ns, statements);
  collectScalars(ctx, ns, statements);
  collectEnums(ctx, ns, statements);
  collectUnions(ctx, ns, statements);
  collectOperations(ctx, ns, statements);
  collectInterfaces(ctx, ns, statements);
  for (const child of ns.namespaces.values()) {
    if (child.name === "TypeSpec" && !child.namespace?.namespace) continue;
    collectNamespace(ctx, child, statements);
  }
}

function collectModels(ctx: Context, ns: Namespace, statements: ts.Statement[]): void {
  for (const model of ns.models.values()) {
    if (isTemplateDeclaration(model) && !canEmitGeneric(ctx, model)) continue;
    statements.push(modelDeclaration(ctx, model));
  }
}

function collectScalars(ctx: Context, ns: Namespace, statements: ts.Statement[]): void {
  for (const scalar of ns.scalars.values()) {
    if (!isTemplateDeclaration(scalar)) statements.push(scalarDeclaration(ctx, scalar));
  }
}

function collectEnums(ctx: Context, ns: Namespace, statements: ts.Statement[]): void {
  for (const en of ns.enums.values()) statements.push(enumDeclaration(ctx, en));
}

function collectUnions(ctx: Context, ns: Namespace, statements: ts.Statement[]): void {
  for (const union of ns.unions.values()) {
    const decl = unionDeclaration(ctx, union);
    if (decl) statements.push(decl);
  }
}

function collectOperations(ctx: Context, ns: Namespace, statements: ts.Statement[]): void {
  for (const op of ns.operations.values()) {
    if (!isTemplateDeclaration(op)) statements.push(operationDeclaration(ctx, op));
  }
}

function collectInterfaces(ctx: Context, ns: Namespace, statements: ts.Statement[]): void {
  for (const iface of ns.interfaces.values()) {
    if (!isTemplateDeclaration(iface)) statements.push(interfaceDeclaration(ctx, iface));
  }
}

function modelDeclaration(ctx: Context, model: Model): ts.Statement {
  const typeParameters = typeParameterDeclarations(ctx, model);
  if (isArrayModelType(model)) {
    return withDoc(
      ctx,
      model,
      f.createTypeAliasDeclaration(
        exportModifier(),
        model.name,
        typeParameters,
        f.createArrayTypeNode(typeToNode(ctx, model.indexer.value)),
      ),
    );
  }
  const heritage = model.baseModel && namedReference(ctx, model.baseModel);
  return withDoc(
    ctx,
    model,
    f.createInterfaceDeclaration(
      exportModifier(),
      model.name,
      typeParameters,
      heritage
        ? [
            f.createHeritageClause(ts.SyntaxKind.ExtendsKeyword, [
              f.createExpressionWithTypeArguments(f.createIdentifier(heritage.name), heritage.args),
            ]),
          ]
        : undefined,
      modelMembers(ctx, model),
    ),
  );
}

function enumDeclaration(ctx: Context, en: Enum): ts.Statement {
  if (isLiteralUnion(ctx.program, en)) {
    return withDoc(
      ctx,
      en,
      f.createTypeAliasDeclaration(
        exportModifier(),
        en.name,
        undefined,
        f.createUnionTypeNode(
          [...en.members.values()].map((member) => literalNode(member.value ?? member.name)),
        ),
      ),
    );
  }
  const members = [...en.members.values()].map((member) => {
    const value = member.value ?? member.name;
    return withDoc(
      ctx,
      member,
      f.createEnumMember(
        propertyName(member.name),
        typeof value === "number" ? f.createNumericLiteral(value) : f.createStringLiteral(value),
      ),
    );
  });
  return withDoc(ctx, en, f.createEnumDeclaration(exportModifier(), en.name, members));
}

function scalarDeclaration(ctx: Context, scalar: Scalar): ts.Statement {
  const override = getTsType(ctx.program, scalar);
  const base = scalar.baseScalar;
  const node = override
    ? overrideNode(ctx, override)
    : !base
      ? unknownType()
      : inStdNamespace(base)
        ? stdScalarNode(ctx, base)
        : f.createTypeReferenceNode(base.name);
  return withDoc(
    ctx,
    scalar,
    f.createTypeAliasDeclaration(exportModifier(), scalar.name, undefined, node),
  );
}

function unionDeclaration(ctx: Context, union: Union): ts.Statement | undefined {
  if (!union.name) return undefined;
  if (isTemplateDeclaration(union) && !canEmitGeneric(ctx, union)) return undefined;
  return withDoc(
    ctx,
    union,
    f.createTypeAliasDeclaration(
      exportModifier(),
      union.name,
      typeParameterDeclarations(ctx, union),
      unionToNode(ctx, union),
    ),
  );
}

function operationDeclaration(ctx: Context, op: Operation): ts.Statement {
  return withDoc(
    ctx,
    op,
    f.createTypeAliasDeclaration(
      exportModifier(),
      op.name,
      undefined,
      f.createFunctionTypeNode(undefined, operationParameters(ctx, op), returnTypeNode(ctx, op)),
    ),
  );
}

function returnTypeNode(ctx: Context, op: Operation, container?: Interface): ts.TypeNode {
  const node = typeToNode(ctx, op.returnType);
  const async =
    isAsync(ctx.program, op) || (container !== undefined && isAsync(ctx.program, container));
  return async ? f.createTypeReferenceNode("Promise", [node]) : node;
}

function operationParameters(ctx: Context, op: Operation): ts.ParameterDeclaration[] {
  return [...op.parameters.properties.values()].map((prop) =>
    f.createParameterDeclaration(
      undefined,
      undefined,
      prop.name,
      prop.optional ? f.createToken(ts.SyntaxKind.QuestionToken) : undefined,
      propertyTypeNode(ctx, prop),
    ),
  );
}

function interfaceDeclaration(ctx: Context, iface: Interface): ts.Statement {
  const members = [...iface.operations.values()].map((op) =>
    withDoc(
      ctx,
      op,
      f.createMethodSignature(
        undefined,
        op.name,
        undefined,
        undefined,
        operationParameters(ctx, op),
        returnTypeNode(ctx, op, iface),
      ),
    ),
  );
  return withDoc(
    ctx,
    iface,
    f.createInterfaceDeclaration(exportModifier(), iface.name, undefined, undefined, members),
  );
}
