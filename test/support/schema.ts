/**
 * A small JSON Schema checker for the subset Ubon's schemas use: type, const,
 * enum, required, properties, additionalProperties, items, $ref to #/$defs,
 * pattern, and minimum. Enough to catch drift between code and schema.
 */

type Schema = Record<string, any>;

export function validate(schema: Schema, value: unknown, root: Schema = schema, path = '$'): string[] {
  if (schema.$ref) {
    const target = (schema.$ref as string).replace(/^#\//, '').split('/').reduce((node: any, key: string) => node?.[key], root);
    if (!target) return [`${path}: unresolved $ref ${schema.$ref}`];
    return validate(target, value, root, path);
  }
  const errors: string[] = [];
  if ('const' in schema && value !== schema.const) errors.push(`${path}: expected ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: ${JSON.stringify(value)} is not one of ${schema.enum.join(', ')}`);
  if (schema.type) {
    const t = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
    const ok =
      schema.type === t || (schema.type === 'integer' && typeof value === 'number' && Number.isInteger(value)) || (schema.type === 'number' && typeof value === 'number');
    if (!ok) return [...errors, `${path}: expected ${schema.type}, got ${t}`];
  }
  if (typeof value === 'string' && schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: ${JSON.stringify(value)} does not match ${schema.pattern}`);
  if (typeof value === 'number' && typeof schema.minimum === 'number' && value < schema.minimum) errors.push(`${path}: below ${schema.minimum}`);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) if (!(key in obj)) errors.push(`${path}: missing ${key}`);
    for (const [key, v] of Object.entries(obj)) {
      const sub = schema.properties?.[key];
      if (sub) errors.push(...validate(sub, v, root, `${path}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${path}: unexpected property ${key}`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') errors.push(...validate(schema.additionalProperties, v, root, `${path}.${key}`));
    }
  }
  if (Array.isArray(value) && schema.items) value.forEach((item, i) => errors.push(...validate(schema.items, item, root, `${path}[${i}]`)));
  return errors;
}
