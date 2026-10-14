#!/usr/bin/env python3
import json
import sys

def is_null(schema):
    return isinstance(schema, dict) and schema.get("type") == "null" and len(schema) == 1

def unwrap_nullable(schema):
    if not isinstance(schema, dict) or set(schema) - {"anyOf", "description"}:
        return None
    branches = schema.get("anyOf") or []
    rest = [b for b in branches if not is_null(b)]
    if len(branches) == 2 and len(rest) == 1:
        return rest[0]
    return None

def is_nullable(schema):
    return isinstance(schema, dict) and schema.get("nullable") is True

VALIDATION_KEYWORDS = {"pattern", "minLength", "maxLength", "minimum", "maximum", "description"}

def drop_validation_all_of(schema):
    branches = schema.get("allOf")
    if "type" in schema and isinstance(branches, list) and all(
        isinstance(b, dict) and set(b) <= VALIDATION_KEYWORDS for b in branches
    ):
        del schema["allOf"]

def walk(node):
    if isinstance(node, list):
        for item in node:
            walk(item)
        return
    if not isinstance(node, dict):
        return
    drop_validation_all_of(node)
    properties = node.get("properties")
    if isinstance(properties, dict):
        for name, schema in list(properties.items()):
            inner = unwrap_nullable(schema)
            if inner is not None:
                properties[name] = inner
            elif is_nullable(schema):
                del schema["nullable"]
            else:
                continue
            if name in node.get("required", []):
                node["required"] = [r for r in node["required"] if r != name]
    for value in node.values():
        walk(value)

def main():
    source, target = sys.argv[1], sys.argv[2]
    with open(source) as f:
        document = json.load(f)
    walk(document)
    with open(target, "w") as f:
        json.dump(document, f, indent=2)

if __name__ == "__main__":
    main()
