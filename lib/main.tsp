import "../dist/index.js";

using TypeSpec.Reflection;

namespace JustTheType;

/** Wrap the return type of the operation (or all operations of an interface) in Promise. */
extern dec promise(target: Operation | Interface);

/** Emit the property (or all properties of the model) with the readonly modifier. */
extern dec readonly(target: ModelProperty | Model);

/**
 * Replace the emitted type with raw TypeScript.
 * @param type TypeScript type text, e.g. "Date" or "Temporal.Instant".
 * @param importFrom Optional module to type-import the type's root identifier from.
 */
extern dec tsType(target: Scalar | ModelProperty, type: valueof string, importFrom?: valueof string);

/** Emit the enum as a union of its literal values instead of a TS enum. */
extern dec literalUnion(target: Enum);
