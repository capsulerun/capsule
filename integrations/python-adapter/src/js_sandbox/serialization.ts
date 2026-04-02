import { MODULE_VALUES, TRANSIENT_KEYS, MODULE_REGISTRY } from "./execution";

export type SerializedValue =
  | { __type__: "primitive"; value: string | number | boolean | null }
  | { __type__: "undefined" }
  | { __type__: "nan" }
  | { __type__: "infinity"; sign: 1 | -1 }
  | { __type__: "bigint"; value: string }
  | { __type__: "date"; value: number }
  | { __type__: "regexp"; source: string; flags: string }
  | { __type__: "list"; value: SerializedValue[] }
  | { __type__: "set"; value: SerializedValue[] }
  | { __type__: "map"; value: [SerializedValue, SerializedValue][] }
  | { __type__: "dict"; value: Record<string, SerializedValue> }
  | { __type__: "classdef"; __source__: string }
  | { __type__: "function"; __source__: string }
  | { __type__: "instance"; __class__: string; __source__: string; __dict__: Record<string, SerializedValue> }
  | { __type__: "module"; name: string }  // use for import/require() modules
  | null;

export function serializeValue(val: unknown): SerializedValue {
  if (val === null) return { __type__: "primitive", value: null };
  if (val === undefined) return { __type__: "undefined" };

  if (typeof val === "boolean" || typeof val === "string") {
    return { __type__: "primitive", value: val };
  }

  if (typeof val === "number") {
    if (Number.isNaN(val)) return { __type__: "nan" };
    if (!Number.isFinite(val)) return { __type__: "infinity", sign: val > 0 ? 1 : -1 };
    return { __type__: "primitive", value: val };
  }

  if (typeof val === "bigint") {
    return { __type__: "bigint", value: val.toString() };
  }

  if (Array.isArray(val)) {
    return { __type__: "list", value: val.map(serializeValue).filter((i): i is SerializedValue => i !== null) };
  }

  if (val instanceof Date) {
    return { __type__: "date", value: val.getTime() };
  }

  if (val instanceof RegExp) {
    return { __type__: "regexp", source: val.source, flags: val.flags };
  }

  if (val instanceof Set) {
    return { __type__: "set", value: [...val].map(serializeValue).filter((i): i is SerializedValue => i !== null) };
  }

  if (val instanceof Map) {
    const entries: [SerializedValue, SerializedValue][] = [];
    for (const [k, v] of val) {
      const sk = serializeValue(k);
      const sv = serializeValue(v);
      if (sk !== null && sv !== null) entries.push([sk, sv]);
    }
    return { __type__: "map", value: entries };
  }

  if (typeof val === "function") {
    const source = (val as Function).toString();
    if (source.startsWith("class ")) {
      return { __type__: "classdef", __source__: source };
    }
    return { __type__: "function", __source__: source };
  }

  if (typeof val === "object") {
    const proto = Object.getPrototypeOf(val);

    if (proto === Object.prototype || proto === null) {
      const pairs: Record<string, SerializedValue> = {};
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        const s = serializeValue(v);
        if (s !== null) pairs[k] = s;
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
      if (s !== null) dict[k] = s;
    }
    return { __type__: "instance", __class__: ctor!.name!, __source__: source, __dict__: dict };
  }

  return null;
}

const MODULE_VALUE_TO_NAME: Map<unknown, string> = new Map(
  Object.entries(MODULE_REGISTRY)
    .filter(([name]) => !name.startsWith("node:"))
    .map(([name, val]) => [val, name])
);

export function serializeEnv(env: Record<string, unknown>): Record<string, SerializedValue> {
  const out: Record<string, SerializedValue> = {};
  for (const [key, val] of Object.entries(env)) {
    if (key.startsWith("__")) continue;
    if (TRANSIENT_KEYS.has(key)) continue;
    if (MODULE_VALUES.has(val)) {
      const name = MODULE_VALUE_TO_NAME.get(val);
      if (name) out[key] = { __type__: "module", name };
      continue;
    }
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
    case "undefined":
      return undefined;
    case "nan":
      return NaN;
    case "infinity":
      return entry.sign > 0 ? Infinity : -Infinity;
    case "bigint":
      return BigInt(entry.value);
    case "date":
      return new Date(entry.value);
    case "regexp":
      return new RegExp(entry.source, entry.flags);
    case "list":
      return entry.value.map((v) => deserializeValue(v, classes));
    case "set":
      return new Set(entry.value.map((v) => deserializeValue(v, classes)));
    case "map":
      return new Map(entry.value.map(([k, v]) => [deserializeValue(k, classes), deserializeValue(v, classes)] as [unknown, unknown]));
    case "dict": {
      const obj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(entry.value)) {
        obj[k] = deserializeValue(v, classes);
      }
      return obj;
    }
    case "classdef":
      return eval(`(${entry.__source__})`);
    case "function":
      return eval(`(${entry.__source__})`);
    case "instance": {
      const Cls = classes[entry.__class__];
      if (!Cls) return undefined;
      const instance = Object.create(Cls.prototype) as Record<string, unknown>;
      for (const [k, v] of Object.entries(entry.__dict__)) {
        instance[k] = deserializeValue(v, classes);
      }
      return instance;
    }
    case "module":
      return MODULE_REGISTRY[entry.name];
    default:
      return undefined;
  }
}

export function deserializeEnv(data: Record<string, SerializedValue>, env: Record<string, unknown>): void {
  const classes: Record<string, new (...args: unknown[]) => unknown> = {};

  for (const [key, entry] of Object.entries(data)) {
    if (entry?.__type__ === "classdef") {
      const Cls = new Function("__env__", `with (__env__) { return (${entry.__source__}); }`)(env);
      env[key] = Cls;
      classes[key] = Cls;
    } else if (entry?.__type__ === "function") {
      env[key] = new Function("__env__", `with (__env__) { return (${entry.__source__}); }`)(env);
    } else if (entry?.__type__ === "instance") {
      if (!classes[entry.__class__]) {
        const Cls = new Function("__env__", `with (__env__) { return (${entry.__source__}); }`)(env);
        classes[entry.__class__] = Cls;
      }
    }
  }

  for (const [key, entry] of Object.entries(data)) {
    if (entry?.__type__ === "classdef" || entry?.__type__ === "function") continue;
    const val = deserializeValue(entry, classes);
    if (val !== undefined) env[key] = val;
  }
}
