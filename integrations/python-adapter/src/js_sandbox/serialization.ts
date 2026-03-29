export type SerializedValue =
  | { __type__: "primitive"; value: unknown }
  | { __type__: "list"; value: SerializedValue[] }
  | { __type__: "dict"; value: Record<string, SerializedValue> }
  | { __type__: "classdef"; __source__: string }
  | { __type__: "instance"; __class__: string; __source__: string; __dict__: Record<string, SerializedValue> }
  | null;

export function serializeValue(val: unknown): SerializedValue {
  if (val === null || typeof val === "number" || typeof val === "string" || typeof val === "boolean") {
    return { __type__: "primitive", value: val };
  }

  if (Array.isArray(val)) {
    const items = val.map(serializeValue);
    if (items.every((i) => i !== null)) {
      return { __type__: "list", value: items as SerializedValue[] };
    }
    return null;
  }

  if (typeof val === "function") {
    const source = val.toString();
    if (source.startsWith("class ")) {
      return { __type__: "classdef", __source__: source };
    }
    return null;
  }

  if (typeof val === "object" && val !== null) {
    const proto = Object.getPrototypeOf(val);

    if (proto === Object.prototype || proto === null) {
      const pairs: Record<string, SerializedValue> = {};
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        const s = serializeValue(v);
        if (s === null) return null;
        pairs[k] = s;
      }
      return { __type__: "dict", value: pairs };
    }

    const ctor = (val as Record<string, unknown>).constructor as
      | { name?: string; toString?: () => string }
      | undefined;
    const source = ctor?.toString?.();
    if (!source?.startsWith("class ")) return null;

    const dict: Record<string, SerializedValue> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      const s = serializeValue(v);
      if (s === null) return null;
      dict[k] = s;
    }
    return { __type__: "instance", __class__: ctor!.name!, __source__: source, __dict__: dict };
  }

  return null;
}

export function serializeEnv(env: Record<string, unknown>): Record<string, SerializedValue> {
  const out: Record<string, SerializedValue> = {};
  for (const [key, val] of Object.entries(env)) {
    if (key.startsWith("__")) continue;
    const s = serializeValue(val);
    if (s !== null) out[key] = s;
  }
  return out;
}

export function deserializeValue(
  entry: SerializedValue,
  classes: Record<string, new (...args: unknown[]) => unknown>
): unknown {
  if (entry === null) return undefined;

  switch (entry.__type__) {
    case "primitive":
      return entry.value;

    case "list":
      return entry.value.map((v) => deserializeValue(v, classes));

    case "dict": {
      const obj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(entry.value)) {
        obj[k] = deserializeValue(v, classes);
      }
      return obj;
    }

    case "instance": {
      const Cls = classes[entry.__class__];
      if (!Cls) return undefined;
      const instance = Object.create(Cls.prototype) as Record<string, unknown>;
      for (const [k, v] of Object.entries(entry.__dict__)) {
        instance[k] = deserializeValue(v, classes);
      }
      return instance;
    }

    default:
      return undefined;
  }
}

export function deserializeEnv(data: Record<string, SerializedValue>, env: Record<string, unknown>): void {
  const classes: Record<string, new (...args: unknown[]) => unknown> = {};

  for (const [key, entry] of Object.entries(data)) {
    if (entry?.__type__ === "classdef") {
      const Cls = eval(`(${entry.__source__})`);
      env[key] = Cls;
      classes[key] = Cls;
    } else if (entry?.__type__ === "instance") {
      if (!classes[entry.__class__]) {
        const Cls = eval(`(${entry.__source__})`);
        classes[entry.__class__] = Cls;
      }
    }
  }

  for (const [key, entry] of Object.entries(data)) {
    if (entry?.__type__ === "classdef") continue;
    const val = deserializeValue(entry, classes);
    if (val !== undefined) env[key] = val;
  }
}
