"""
Roll up attributes onto grouping assets.

Each non-leaf asset (root / Unit / Process / SubProcess) gets the union of all its
descendant machine attributes, with tagNames prefixed by the relative path so they
are unique AND match the dot-flattened telemetry keys (e.g. the root ends up with
"Unit 1.Synthetic Dyeing.Preparation.Creel Machine.powerKW").

Run once after building the asset tree:
    python rollup_group_attributes.py
"""
import json
import sys
import urllib.request

API = "http://localhost:8080/api"

def get(path):
    with urllib.request.urlopen(API + path, timeout=20) as r:
        return json.loads(r.read())

def post(path, body):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read())
    except Exception as e:
        return 0, str(e)

def main():
    assets = get("/assets")
    children = {}
    for a in assets:
        children.setdefault(a.get("parentId"), []).append(a)
    is_leaf = lambda a: not children.get(a["id"])

    def descendant_leaves(node, path):
        out = []
        for c in children.get(node["id"], []):
            p = path + [c["name"]]
            if is_leaf(c):
                out.append((p, c))
            else:
                out.extend(descendant_leaves(c, p))
        return out

    updated = 0
    for a in assets:
        if is_leaf(a):
            continue
        defs, seen = [], set()
        for path, leaf in descendant_leaves(a, []):
            try:
                attrs = get(f"/assets/{leaf['id']}/attributes")
            except Exception:
                attrs = []
            if not isinstance(attrs, list):
                continue
            prefix = ".".join(path)
            for at in attrs:
                base = at.get("tagName") or at.get("name")
                if not base:
                    continue
                tag = f"{prefix}.{base}"
                if tag.lower() in seen:
                    continue
                seen.add(tag.lower())
                defs.append({
                    "name": f"{prefix}.{at.get('name') or base}",
                    "type": at.get("type") or "dynamic",
                    "dataType": at.get("dataType") or "double",
                    "tagName": tag,
                    "uom": at.get("uom") or "",
                })
        if defs:
            st, resp = post(f"/assets/{a['id']}/attributes/bulk", {"attributes": defs})
            created = resp.get("created", "?") if isinstance(resp, dict) else "?"
            print(f"  {a['name']}: rolled up {len(defs)} attrs -> HTTP {st} (created {created})")
            updated += 1
    print(f"Done. Updated {updated} grouping assets.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
