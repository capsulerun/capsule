import ast
import base64
import inspect
import types

_MISSING = object()


def _serialize_env(env: dict) -> dict:
    out = {}
    for key, val in env.items():
        if key.startswith("__"):
            continue
        serialized = _serialize_value(val)
        if serialized is not None:
            out[key] = serialized
    return out


def _serialize_value(val):
    if isinstance(val, bool) or val is None:
        return {"__type__": "primitive", "value": val}

    if isinstance(val, float):
        if val != val:
            return {"__type__": "nan"}
        if val == float("inf"):
            return {"__type__": "infinity", "sign": 1}
        if val == float("-inf"):
            return {"__type__": "infinity", "sign": -1}
        return {"__type__": "primitive", "value": val}

    if isinstance(val, (int, str)):
        return {"__type__": "primitive", "value": val}

    if isinstance(val, complex):
        return {"__type__": "complex", "real": val.real, "imag": val.imag}

    if isinstance(val, bytes):
        return {"__type__": "bytes", "value": base64.b64encode(val).decode()}

    if isinstance(val, tuple):
        items = [_serialize_value(v) for v in val]
        return {"__type__": "tuple", "value": [i for i in items if i is not None]}

    if isinstance(val, list):
        items = [_serialize_value(v) for v in val]
        return {"__type__": "list", "value": [i for i in items if i is not None]}

    if isinstance(val, frozenset):
        items = [_serialize_value(v) for v in val]
        return {"__type__": "frozenset", "value": [i for i in items if i is not None]}

    if isinstance(val, set):
        items = [_serialize_value(v) for v in val]
        return {"__type__": "set", "value": [i for i in items if i is not None]}

    if isinstance(val, dict):
        pairs = {}
        for k, v in val.items():
            if not isinstance(k, str):
                continue
            serialized = _serialize_value(v)
            if serialized is not None:
                pairs[k] = serialized
        return {"__type__": "dict", "value": pairs}

    if isinstance(val, type):
        try:
            source = inspect.getsource(val)
        except (OSError, TypeError):
            source = getattr(val, "__source__", None)
        if source:
            return {"__type__": "classdef", "__source__": source}
        return None

    if isinstance(val, types.ModuleType):
        return {"__type__": "module", "name": val.__name__}

    if isinstance(val, (types.FunctionType, types.MethodType)):
        source = getattr(val, "__source__", None)
        if source:
            return {"__type__": "function", "__source__": source}
        return None

    if hasattr(val, "__dict__") and hasattr(val, "__class__"):
        cls = val.__class__
        try:
            source = inspect.getsource(cls)
        except (OSError, TypeError):
            source = getattr(cls, "__source__", None)
        if not source:
            return None
        instance_dict = _serialize_value(val.__dict__)
        if instance_dict is None:
            return None
        return {
            "__type__": "instance",
            "__class__": cls.__name__,
            "__source__": source,
            "__dict__": instance_dict["value"],
        }

    return None


def _deserialize_value(entry: dict, env: dict):
    t = entry.get("__type__")

    if t == "primitive":
        return entry["value"]
    if t == "nan":
        return float("nan")
    if t == "infinity":
        return float("inf") if entry["sign"] == 1 else float("-inf")
    if t == "complex":
        return complex(entry["real"], entry["imag"])
    if t == "bytes":
        return base64.b64decode(entry["value"])
    if t == "tuple":
        return tuple(_deserialize_list(entry["value"], env))
    if t == "list":
        return _deserialize_list(entry["value"], env)
    if t == "frozenset":
        return frozenset(_deserialize_list(entry["value"], env))
    if t == "set":
        return set(_deserialize_list(entry["value"], env))
    if t == "dict":
        return _deserialize_dict(entry["value"], env)

    if t == "module":
        import importlib
        return importlib.import_module(entry["name"])

    if t == "classdef":
        source = entry["__source__"]
        exec(compile(source, "<session>", "exec"), env)
        for node in ast.parse(source).body:
            if isinstance(node, ast.ClassDef):
                cls = env.get(node.name)
                if cls is not None:
                    cls.__source__ = source
                    return cls
        return _MISSING

    if t == "function":
        source = entry["__source__"]
        exec(compile(source, "<session>", "exec"), env)
        for node in ast.parse(source).body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                fn = env.get(node.name)
                if fn is not None:
                    fn.__source__ = source
                    return fn
        return _MISSING

    if t == "instance":
        return _reconstruct_instance(entry, env)

    return _MISSING


def _reconstruct_instance(entry: dict, env: dict):
    cls_name = entry["__class__"]
    source = entry["__source__"]
    if cls_name not in env:
        exec(compile(source, "<session>", "exec"), env)
        if cls_name in env:
            env[cls_name].__source__ = source
    cls = env.get(cls_name)
    if cls is None:
        return _MISSING
    instance = object.__new__(cls)
    instance.__dict__.update(_deserialize_dict(entry["__dict__"], env))
    return instance


def _deserialize_list(items: list, env: dict) -> list:
    result = []
    for item in items:
        value = _deserialize_value(item, env)
        if value is not _MISSING:
            result.append(value)
    return result


def _deserialize_dict(pairs: dict, env: dict) -> dict:
    result = {}
    for k, v in pairs.items():
        value = _deserialize_value(v, env)
        if value is not _MISSING:
            result[k] = value
    return result


def _deserialize_env(data: dict, env: dict) -> None:
    for key, entry in data.items():
        if not isinstance(entry, dict):
            continue
        t = entry.get("__type__")
        if t == "classdef":
            source = entry["__source__"]
            exec(compile(source, "<session>", "exec"), env)
            cls = env.get(key)
            if cls is not None:
                cls.__source__ = source
        elif t == "function":
            source = entry["__source__"]
            exec(compile(source, "<session>", "exec"), env)
            fn = env.get(key)
            if fn is not None:
                fn.__source__ = source

    for key, entry in data.items():
        if not isinstance(entry, dict):
            continue
        if entry.get("__type__") in ("classdef", "function"):
            continue
        value = _deserialize_value(entry, env)
        if value is not _MISSING:
            env[key] = value
