"""
Assign per-machine device IDs to machine assets.

Reads a Node-RED nested payload (each machine object has its own `deviceId`),
walks it to map machine PATH -> deviceId, then matches each to the asset tree by
path and sets that asset's identifier = deviceId (registering the device first).

Run after applying the device-optional backend change + restarting the API:
    python assign_machine_devices.py payload.json
(where payload.json is the nested Node-RED payload you pasted).
"""
import json
import sys
import urllib.request

API = "http://localhost:8080/api"
ENVELOPE = {"deviceid", "timestamp", "timestampunix", "capturedat", "receivedat", "machine", "assetid"}

def get(path):
    with urllib.request.urlopen(API + path, timeout=20) as r:
        return json.loads(r.read())

def send(path, body, method="POST"):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:150]

def walk_payload(node, path, out):
    """Collect (path_names, deviceId) for every machine object."""
    if isinstance(node, list):
        for item in node:
            if isinstance(item, dict) and isinstance(item.get("deviceId"), str):
                name = item.get("machine") or item.get("name") or "Machine"
                out.append((path + [str(name)], item["deviceId"]))
            else:
                walk_payload(item, path, out)
    elif isinstance(node, dict):
        for k, v in node.items():
            if k.lower() in ENVELOPE:
                continue
            if isinstance(v, (dict, list)):
                walk_payload(v, path + [k], out)

def main():
    if len(sys.argv) < 2:
        sys.exit("Usage: python assign_machine_devices.py <payload.json>")
    payload = json.load(open(sys.argv[1], encoding="utf-8"))

    machines = []
    walk_payload(payload, [], machines)
    if not machines:
        sys.exit("No machine objects with a deviceId found in the payload.")
    print(f"  Found {len(machines)} machine device ids in payload.")

    assets = get("/assets")
    by_id = {a["id"]: a for a in assets}
    def path_of(a):
        names, cur = [], a
        seen = set()
        while cur and cur["id"] not in seen:
            seen.add(cur["id"]); names.append(cur["name"].lower())
            cur = by_id.get(cur.get("parentId"))
        return list(reversed(names))
    asset_paths = [(a, path_of(a)) for a in assets]

    ok = fail = 0
    for names, devId in machines:
        want = [n.lower() for n in names]
        # match the asset whose full path ENDS WITH the payload path
        match = next((a for a, p in asset_paths if len(p) >= len(want) and p[-len(want):] == want), None)
        if not match:
            print(f"  ! no asset for path {'/'.join(names)} ({devId})"); fail += 1; continue
        send("/ingest/register-device", {"deviceId": devId})
        st, _ = send(f"/assets/{match['id']}", {"identifier": devId}, method="PUT")
        if 200 <= st < 300:
            ok += 1; print(f"  OK  {match['name']:<26} -> {devId}")
        else:
            fail += 1; print(f"  ERR {match['name']} -> {devId} (HTTP {st})")
    print(f"Done. Assigned {ok} device ids ({fail} failed).")

if __name__ == "__main__":
    import urllib.error
    main()
