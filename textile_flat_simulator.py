"""
Flat telemetry simulator for a single-asset / single-device textile setup.

Reads the attribute definitions of the template attached to a given device id
(default "testing") straight from the API, then pushes a FLAT payload whose keys
are exactly those attribute tagNames — so all attributes populate live and charts
work. No hardcoded tag list; it always matches whatever your template defines.

Run:
    python textile_flat_simulator.py                # loop every 5s, device "testing"
    python textile_flat_simulator.py --device testing --interval 3
    python textile_flat_simulator.py --once         # send one payload and exit
    python textile_flat_simulator.py --dry-run      # print payload, don't POST
"""

import argparse
import random
import signal
import sys
import time
from datetime import datetime, timezone

import urllib.request
import urllib.error
import json

API = "http://localhost:5173/api"          # Vite proxy → api-server; use :8080 to hit it directly
DEVICE_ID = "testing"
INTERVAL_SEC = 5.0

# ── value generation by tag name / data type ───────────────────────────────
def rnd(lo, hi, integer=False):
    v = random.uniform(lo, hi)
    return int(round(v)) if integer else round(v, 2)

def value_for(tag: str, data_type: str):
    t = tag.lower()
    # text-ish fields
    if data_type == "text":
        if "status" in t:  return random.choices(["Running", "Idle", "Maintenance", "Fault"], [70, 15, 10, 5])[0]
        if "shift" in t:   return random.choice(["A", "B", "C"])
        if "batch" in t:   return f"BATCH-{random.randint(1000, 99999)}"
        if "machine" in t: return tag  # machine name field
        return "OK"
    if data_type == "boolean":
        return random.random() < 0.9
    # numeric — pick a sensible range from the tag name
    if "temperature" in t or "temp" in t:      return rnd(20, 240)
    if "vibration" in t:                        return rnd(0.1, 1.5)
    if "powerkw" in t or t.endswith("power"):   return rnd(4, 45)
    if "rpm" in t or "spindlespeed" in t or "rotorspeed" in t: return rnd(1000, 60000, True)
    if "humidity" in t:                         return rnd(40, 70)
    if "efficiency" in t or "accuracy" in t or "uniformity" in t or "retention" in t or "exhaustion" in t:
        return rnd(70, 98)
    if "ph" in t:                               return rnd(4, 8)
    if "energy" in t or "kwh" in t:             return rnd(50, 500)
    if "downtime" in t:                         return rnd(0, 30, True)
    if "pressure" in t or "bar" in t:           return rnd(80, 120)
    if "current" in t or t.endswith("amps"):    return rnd(1, 50)
    if "voltage" in t:                          return rnd(210, 240)
    if "flow" in t:                             return rnd(200, 400)
    if "speed" in t:                            return rnd(20, 1500, True)
    if "count" in t or "cycles" in t or "perinch" in t or "perhour" in t:
        return rnd(0, 120, True)
    if "kg" in t or "weight" in t or "loaded" in t or "removed" in t:
        return rnd(5, 1000, True)
    if "ratio" in t or "denier" in t or "cv" in t or "variation" in t or "breakage" in t:
        return rnd(0.5, 15)
    return rnd(0, 100)

# ── HTTP helpers (stdlib only) ──────────────────────────────────────────────
def get_json(url: str):
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read().decode("utf-8"))

def post_json(url: str, body: dict) -> tuple[int, str]:
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, r.read().decode("utf-8")[:200]
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8")[:200]

def load_tagdefs(device_id: str):
    """Find the asset with identifier == device_id, then its template's attribute defs."""
    assets = get_json(f"{API}/assets")
    asset = next((a for a in assets if (a.get("identifier") or "") == device_id), None)
    if not asset:
        sys.exit(f"No asset found with device id '{device_id}'. Create the asset first (identifier = {device_id}).")
    # Read the asset's OWN attributes (materialized from a template or added manually).
    # Robust — doesn't depend on templateId being set on the asset.
    attrs = get_json(f"{API}/assets/{asset['id']}/attributes")
    if not isinstance(attrs, list):
        attrs = []
    tags = [(a.get("tagName") or a.get("name"), a.get("dataType") or "double") for a in attrs if (a.get("tagName") or a.get("name"))]
    if not tags:
        sys.exit(
            f"Asset '{asset.get('name')}' has no attributes yet.\n"
            f"Apply a template to it first: Assets -> {asset.get('name')} -> Attributes tab -> Add -> Apply Template -> pick your template."
        )
    print(f"  Asset '{asset.get('name')}' (device '{device_id}') · {len(tags)} attributes")
    return tags

def build_payload(device_id: str, tags):
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    payload = {"deviceId": device_id, "timestamp": now}
    for tag, dt in tags:
        payload[tag] = value_for(tag, dt)
    return payload

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--device", default=DEVICE_ID)
    ap.add_argument("--interval", type=float, default=INTERVAL_SEC)
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    print(f"Textile flat simulator → {API}/ingest/payload  (device '{args.device}')")
    tags = load_tagdefs(args.device)

    stop = {"flag": False}
    def handler(_s, _f): stop["flag"] = True; print("\nStopping…")
    signal.signal(signal.SIGINT, handler)

    while not stop["flag"]:
        payload = build_payload(args.device, tags)
        if args.dry_run:
            print(json.dumps(payload, indent=2)[:1500])
        else:
            code, _ = post_json(f"{API}/ingest/payload", payload)
            ts = datetime.now().strftime("%H:%M:%S")
            print(f"  {ts}  POST {len(tags)} tags → HTTP {code}")
        if args.once:
            break
        time.sleep(args.interval)
    return 0

if __name__ == "__main__":
    sys.exit(main())
