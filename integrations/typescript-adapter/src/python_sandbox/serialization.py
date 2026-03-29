import inspect

_PRIMITIVE_TYPES = (int, float, str, bool, type(None))


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
    if isinstance(val, _PRIMITIVE_TYPES):
        return {"__type__": "primitive", "value": val}

    if isinstance(val, list):
        items = [_serialize_value(v) for v in val]
        if all(i is not None for i in items):
            return {"__type__": "list", "value": items}
        return None

    if isinstance(val, dict):
        pairs = {k: _serialize_value(v) for k, v in val.items() if isinstance(k, str)}
        if all(v is not None for v in pairs.values()):
            return {"__type__": "dict", "value": pairs}
        return None

    if isinstance(val, type):
        try:
            source = inspect.getsource(val)
        except (OSError, TypeError):
            source = getattr(val, "__source__", None)
        if source:
            return {"__type__": "classdef", "__source__": source}
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


def _deserialize_env(data: dict, env: dict) -> None:
    for key, entry in data.items():
        if isinstance(entry, dict) and entry.get("__type__") == "classdef":
            source = entry["__source__"]
            exec(compile(source, "<session>", "exec"), env)
            if key in env:
                env[key].__source__ = source

    for key, entry in data.items():
        if not isinstance(entry, dict):
            continue
        t = entry.get("__type__")

        if t == "classdef":
            pass

        elif t == "primitive":
            env[key] = entry["value"]

        elif t == "list":
            env[key] = _deserialize_list(entry["value"], env)

        elif t == "dict":
            env[key] = _deserialize_dict(entry["value"], env)

        elif t == "instance":
            cls_name = entry["__class__"]
            source = entry["__source__"]

            if cls_name not in env:
                exec(compile(source, "<session>", "exec"), env)
                if cls_name in env:
                    env[cls_name].__source__ = source

            cls = env.get(cls_name)
            if cls is None:
                continue

            instance = object.__new__(cls)
            instance.__dict__.update(_deserialize_dict(entry["__dict__"], env))
            env[key] = instance


def _deserialize_list(items: list, env: dict) -> list:
    result = []
    for item in items:
        t = item.get("__type__")
        if t == "primitive":
            result.append(item["value"])
        elif t == "list":
            result.append(_deserialize_list(item["value"], env))
        elif t == "dict":
            result.append(_deserialize_dict(item["value"], env))
    return result


def _deserialize_dict(pairs: dict, env: dict) -> dict:
    result = {}
    for k, v in pairs.items():
        t = v.get("__type__")
        if t == "primitive":
            result[k] = v["value"]
        elif t == "list":
            result[k] = _deserialize_list(v["value"], env)
        elif t == "dict":
            result[k] = _deserialize_dict(v["value"], env)
    return result

