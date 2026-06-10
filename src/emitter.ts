import {
  Enum,
  Expression,
  Interface,
  Model,
  ModelProperty,
  Namespace,
  Operation,
  Program,
  Scalar,
  Type,
  Union,
  getDoc,
  isArrayModelType,
  isRecordModelType,
  isTemplateDeclaration,
} from "@typespec/compiler";
import ts from "typescript";
import { TsTypeOverride, getTsType, isAsync, isLiteralUnion, isReadonly } from "./decorators.js";

const f = ts.factory;

interface Context {
  program: Program;
  imports: Map<string, Set<string>>;
}

const stringType = () => f.createKeywordTypeNode(ts.SyntaxKind.StringKeyword);
const numberType = () => f.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword);
const bigintType = () => f.createKeywordTypeNode(ts.SyntaxKind.BigIntKeyword);
const unknownType = () => f.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword);

const scalarMap: Record<string, () => ts.TypeNode> = {
  string: stringType,
  boolean: () => f.createKeywordTypeNode(ts.SyntaxKind.BooleanKeyword),
  bytes: () => f.createTypeReferenceNode("Uint8Array"),
  int64: bigintType,
  uint64: bigintType,
  numeric: numberType,
  integer: numberType,
  float: numberType,
  decimal: numberType,
  decimal128: numberType,
  float32: numberType,
  float64: numberType,
  int32: numberType,
  int16: numberType,
  int8: numberType,
  safeint: numberType,
  uint32: numberType,
  uint16: numberType,
  uint8: numberType,
  url: stringType,
  plainDate: stringType,
  plainTime: stringType,
  utcDateTime: stringType,
  offsetDateTime: stringType,
  duration: stringType,
};

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
      f.createImportClause(
        ts.SyntaxKind.TypeKeyword,
        undefined,
        f.createNamedImports(
          [...names].sort().map((name) => f.createImportSpecifier(false, undefined, f.createIdentifier(name))),
        ),
      ),
      f.createStringLiteral(module),
    ),
  );
}

function collectNamespace(ctx: Context, ns: Namespace, statements: ts.Statement[]): void {
  for (const model of ns.models.values()) {
    if (isTemplateDeclaration(model) && !canEmitGeneric(ctx, model)) continue;
    statements.push(modelDeclaration(ctx, model));
  }
  for (const scalar of ns.scalars.values()) {
    if (!isTemplateDeclaration(scalar)) statements.push(scalarDeclaration(ctx, scalar));
  }
  for (const en of ns.enums.values()) statements.push(enumDeclaration(ctx, en));
  for (const union of ns.unions.values()) {
    if (!union.name) continue;
    if (isTemplateDeclaration(union) && !canEmitGeneric(ctx, union)) continue;
    statements.push(
      withDoc(
        ctx,
        union,
        f.createTypeAliasDeclaration(
          exportModifier(),
          union.name,
          typeParameterDeclarations(ctx, union),
          unionToNode(ctx, union),
        ),
      ),
    );
  }
  for (const op of ns.operations.values()) {
    if (isTemplateDeclaration(op)) continue;
    statements.push(
      withDoc(
        ctx,
        op,
        f.createTypeAliasDeclaration(
          exportModifier(),
          op.name,
          undefined,
          f.createFunctionTypeNode(undefined, operationParameters(ctx, op), returnTypeNode(ctx, op)),
        ),
      ),
    );
  }
  for (const iface of ns.interfaces.values()) {
    if (!isTemplateDeclaration(iface)) statements.push(interfaceDeclaration(ctx, iface));
  }
  for (const child of ns.namespaces.values()) {
    if (child.name === "TypeSpec" && !child.namespace?.namespace) continue;
    collectNamespace(ctx, child, statements);
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

function modelMembers(ctx: Context, model: Model): ts.TypeElement[] {
  const members: ts.TypeElement[] = [...model.properties.values()].map((prop) =>
    withDoc(
      ctx,
      prop,
      f.createPropertySignature(
        isReadonly(ctx.program, prop) || isReadonly(ctx.program, model)
          ? [f.createModifier(ts.SyntaxKind.ReadonlyKeyword)]
          : undefined,
        propertyName(prop.name),
        prop.optional ? f.createToken(ts.SyntaxKind.QuestionToken) : undefined,
        propertyTypeNode(ctx, prop),
      ),
    ),
  );
  if (model.indexer && model.indexer.key.name === "string") {
    members.push(
      f.createIndexSignature(
        undefined,
        [f.createParameterDeclaration(undefined, undefined, "key", undefined, stringType())],
        typeToNode(ctx, model.indexer.value),
      ),
    );
  }
  return members;
}

function propertyTypeNode(ctx: Context, prop: ModelProperty): ts.TypeNode {
  const override = getTsType(ctx.program, prop);
  return override ? overrideNode(ctx, override) : typeToNode(ctx, prop.type);
}

function overrideNode(ctx: Context, override: TsTypeOverride): ts.TypeNode {
  if (override.from) {
    const root = override.type.split(/[.<]/)[0];
    const names = ctx.imports.get(override.from) ?? new Set();
    names.add(root);
    ctx.imports.set(override.from, names);
  }
  return f.createTypeReferenceNode(override.type);
}

function propertyName(name: string): ts.PropertyName {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? f.createIdentifier(name) : f.createStringLiteral(name);
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
        f.createUnionTypeNode([...en.members.values()].map((member) => literalNode(member.value ?? member.name))),
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

function literalNode(value: string | number): ts.TypeNode {
  return f.createLiteralTypeNode(
    typeof value === "number" ? f.createNumericLiteral(value) : f.createStringLiteral(value),
  );
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
  return withDoc(ctx, scalar, f.createTypeAliasDeclaration(exportModifier(), scalar.name, undefined, node));
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

function unionToNode(ctx: Context, union: Union): ts.TypeNode {
  return f.createUnionTypeNode(
    [...union.variants.values()].map((variant) => typeToNode(ctx, variant.type)),
  );
}

function typeToNode(ctx: Context, type: Type): ts.TypeNode {
  switch (type.kind) {
    case "Model": {
      // Inside template declarations Array<T>/Record<T> instances carry no
      // indexer yet, so resolve them via their template argument instead.
      const element =
        (type.name === "Array" || type.name === "Record") && inStdNamespace(type)
          ? (type.indexer?.value ?? typeArgument(type))
          : undefined;
      if (element) {
        return type.name === "Array"
          ? f.createArrayTypeNode(typeToNode(ctx, element))
          : f.createTypeReferenceNode("Record", [stringType(), typeToNode(ctx, element)]);
      }
      if (isArrayModelType(type)) {
        return f.createArrayTypeNode(typeToNode(ctx, type.indexer.value));
      }
      if (isRecordModelType(type)) {
        return f.createTypeReferenceNode("Record", [stringType(), typeToNode(ctx, type.indexer.value)]);
      }
      const ref = namedReference(ctx, type);
      return ref
        ? f.createTypeReferenceNode(ref.name, ref.args)
        : f.createTypeLiteralNode(modelMembers(ctx, type));
    }
    case "Scalar":
      // User scalars are declared as aliases, so a @tsType override applies
      // at the declaration site and references keep using the scalar's name.
      return inStdNamespace(type) ? stdScalarNode(ctx, type) : f.createTypeReferenceNode(type.name);
    case "Enum":
      return f.createTypeReferenceNode(type.name);
    case "EnumMember":
      if (isLiteralUnion(ctx.program, type.enum)) {
        return literalNode(type.value ?? type.name);
      }
      return f.createTypeReferenceNode(
        f.createQualifiedName(f.createIdentifier(type.enum.name), type.name),
      );
    case "Union": {
      const ref = type.name ? namedReference(ctx, type) : undefined;
      return ref ? f.createTypeReferenceNode(ref.name, ref.args) : unionToNode(ctx, type);
    }
    case "Tuple": {
      const tuple = f.createTupleTypeNode(type.values.map((value) => typeToNode(ctx, value)));
      return ts.setEmitFlags(tuple, ts.EmitFlags.SingleLine);
    }
    case "TemplateParameter":
      return f.createTypeReferenceNode((type.node as unknown as TemplateParamDeclaration).id.sv);
    case "String":
      return f.createLiteralTypeNode(f.createStringLiteral(type.value));
    case "Number":
      return f.createLiteralTypeNode(f.createNumericLiteral(type.value));
    case "Boolean":
      return f.createLiteralTypeNode(type.value ? f.createTrue() : f.createFalse());
    case "StringTemplate":
      return stringTemplateToNode(ctx, type);
    case "Intrinsic":
      switch (type.name) {
        case "null":
          return f.createLiteralTypeNode(f.createNull());
        case "void":
          return f.createKeywordTypeNode(ts.SyntaxKind.VoidKeyword);
        case "never":
          return f.createKeywordTypeNode(ts.SyntaxKind.NeverKeyword);
        default:
          return unknownType();
      }
    default:
      return unknownType();
  }
}

function stringTemplateToNode(ctx: Context, template: Type & { kind: "StringTemplate" }): ts.TypeNode {
  if (template.stringValue !== undefined) {
    return f.createLiteralTypeNode(f.createStringLiteral(template.stringValue));
  }
  const spans = [...template.spans];
  let i = 0;
  let head = "";
  while (i < spans.length && !spans[i].isInterpolated) {
    head += (spans[i].type as Type & { value: string }).value;
    i++;
  }
  const tsSpans: ts.TemplateLiteralTypeSpan[] = [];
  while (i < spans.length) {
    const inner = typeToNode(ctx, spans[i].type);
    i++;
    let text = "";
    while (i < spans.length && !spans[i].isInterpolated) {
      text += (spans[i].type as Type & { value: string }).value;
      i++;
    }
    tsSpans.push(
      f.createTemplateLiteralTypeSpan(
        inner,
        i >= spans.length ? f.createTemplateTail(text) : f.createTemplateMiddle(text),
      ),
    );
  }
  return f.createTemplateLiteralType(f.createTemplateHead(head), tsSpans);
}

function typeArgument(type: Model): Type | undefined {
  const arg = type.templateMapper?.args[0];
  return arg?.entityKind === "Type" ? arg : undefined;
}

function namedReference(
  ctx: Context,
  type: Model | Union,
): { name: string; args?: ts.TypeNode[] } | undefined {
  if (!type.name || inStdNamespace(type)) return undefined;
  if (!type.templateMapper) return { name: type.name };
  if (!canEmitGeneric(ctx, type)) return undefined;
  const args: ts.TypeNode[] = [];
  for (const arg of type.templateMapper.args) {
    if (arg.entityKind !== "Type") return undefined;
    args.push(typeToNode(ctx, arg));
  }
  return { name: type.name, args };
}

// TemplateParameterDeclarationNode is not exported from @typespec/compiler.
interface TemplateParamDeclaration {
  readonly id: { readonly sv: string };
  readonly constraint?: Expression;
  readonly default?: Expression;
}

function templateParamNodes(type: Model | Union): readonly TemplateParamDeclaration[] {
  const node = type.node as
    | { templateParameters?: readonly TemplateParamDeclaration[] }
    | undefined;
  return node?.templateParameters ?? [];
}

// `valueof` constraints have no type-level equivalent; the checker resolves
// them to ErrorType, which marks the template as not emittable as a generic.
function resolveExpression(ctx: Context, expr: Expression): Type | undefined {
  const type = ctx.program.checker.getTypeForNode(expr);
  return type.kind === "Intrinsic" && type.name === "ErrorType" ? undefined : type;
}

function canEmitGeneric(ctx: Context, type: Model | Union): boolean {
  return templateParamNodes(type).every(
    (param) => !param.constraint || resolveExpression(ctx, param.constraint),
  );
}

function typeParameterDeclarations(
  ctx: Context,
  type: Model | Union,
): ts.TypeParameterDeclaration[] | undefined {
  const params = templateParamNodes(type);
  if (params.length === 0) return undefined;
  return params.map((param) => {
    const constraint = param.constraint && resolveExpression(ctx, param.constraint);
    const defaultType = param.default && resolveExpression(ctx, param.default);
    return f.createTypeParameterDeclaration(
      undefined,
      param.id.sv,
      constraint && typeToNode(ctx, constraint),
      defaultType && typeToNode(ctx, defaultType),
    );
  });
}

function stdScalarNode(ctx: Context, scalar: Scalar): ts.TypeNode {
  let current: Scalar | undefined = scalar;
  while (current) {
    const override = getTsType(ctx.program, current);
    if (override) return overrideNode(ctx, override);
    const mapped = scalarMap[current.name];
    if (mapped) return mapped();
    current = current.baseScalar;
  }
  return unknownType();
}

function inStdNamespace(type: { namespace?: Namespace }): boolean {
  let ns = type.namespace;
  while (ns?.namespace) {
    if (!ns.namespace.name && !ns.namespace.namespace) return ns.name === "TypeSpec";
    ns = ns.namespace;
  }
  return false;
}

function withDoc<T extends ts.Node>(ctx: Context, type: Type, node: T): T {
  const doc = getDoc(ctx.program, type);
  if (doc) {
    ts.addSyntheticLeadingComment(
      node,
      ts.SyntaxKind.MultiLineCommentTrivia,
      `* ${doc.replace(/\n/g, "\n * ")} `,
      true,
    );
  }
  return node;
}
