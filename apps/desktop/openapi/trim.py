#!/usr/bin/env python3
import json
import sys

def refs(node):
    if isinstance(node, list):
        for item in node:
            yield from refs(item)
    elif isinstance(node, dict):
        for key, value in node.items():
            if key == "$ref" and isinstance(value, str):
                yield value
            else:
                yield from refs(value)

def security_names(requirements):
    return {name for requirement in requirements or [] for name in requirement}

def main():
    source, target, keep = sys.argv[1], sys.argv[2], sys.argv[3:]
    with open(source) as f:
        document = json.load(f)

    paths = document.get("paths", {})
    missing = [path for path in keep if path not in paths]
    if missing:
        sys.exit(f"trim.py: not in {source}: {', '.join(missing)}")
    document["paths"] = {path: item for path, item in paths.items() if path in keep}

    components = document.get("components", {})
    reached, pending = set(), list(refs(document["paths"]))
    while pending:
        ref = pending.pop()
        if ref in reached or not ref.startswith("#/components/"):
            continue
        reached.add(ref)
        _, _, kind, name = ref.split("/", 3)
        pending.extend(refs(components.get(kind, {}).get(name)))

    operations = [op for item in document["paths"].values() for op in item.values() if isinstance(op, dict)]
    schemes = security_names(document.get("security"))
    for operation in operations:
        schemes |= security_names(operation.get("security"))
    used_tags = {tag for operation in operations for tag in operation.get("tags", [])}

    trimmed = {}
    for kind, entries in components.items():
        kept = {
            name: value
            for name, value in entries.items()
            if f"#/components/{kind}/{name}" in reached or (kind == "securitySchemes" and name in schemes)
        }
        if kept:
            trimmed[kind] = kept
    document["components"] = trimmed
    if "tags" in document:
        document["tags"] = [tag for tag in document["tags"] if tag.get("name") in used_tags]

    with open(target, "w") as f:
        json.dump(document, f, indent=2, ensure_ascii=False)
        f.write("\n")

if __name__ == "__main__":
    main()
