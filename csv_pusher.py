"""
CSV → Ingest pusher for the Integrated Suite IoT platform.

Reads a CSV file and POSTs each row as a telemetry payload to /api/ingest/payload.

CSV rules
---------
- One column MUST be the device id. Default header name: "deviceId".
  This value MUST equal the target asset's *identifier* so the platform links
  the reading to that asset (and its template attributes).
- Every other column is treated as a metric. Header names should match the
  template tagNames (e.g. temperature, vibration_rms_velocity_x, ultrasound,
  battery, runhours, sensor_serial).
- Optional "timestamp" column (ISO 8601). If absent, current time is used.
- Numeric strings are sent as numbers; everything else stays a string.

Usage
-----
  python csv_pusher.py --make-sample            # write sensor_data.csv you can edit
  python csv_pusher.py --file sensor_data.csv   # push every row once
  python csv_pusher.py --file sensor_data.csv --dry-run
  python csv_pusher.py --file sensor_data.csv --device-id SENSOR-01   # override id for all rows
  python csv_pusher.py --file sensor_data.csv --loop --interval 10     # re-push on a loop

Endpoint + TLS are configured the same way as energy_simulator.py (env vars).
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ENDPOINT = os.getenv(
    "ENDPOINT",
    "http://localhost:8080/api/ingest/payload",
)
HTTP_TIMEOUT_SECONDS = int(os.getenv("HTTP_TIMEOUT_SECONDS", "30"))
VERIFY_TLS = os.getenv("VERIFY_TLS", "false").lower() in {"1", "true", "yes"}

# CSV column that holds the device id (must equal the asset identifier).
DEVICE_ID_COLUMN = os.getenv("DEVICE_ID_COLUMN", "deviceId")

DEFAULT_CSV = Path(os.getenv("CSV_FILE", "sensor_data.csv"))

# Sample matching the SENSOR template attributes shown in the UI.
SAMPLE_CSV = """\
deviceId,timestamp,temperature,vibration_rms_velocity_x,ultrasound,battery,runhours,sensor_serial
SENSOR-01,,42.5,2.13,18.4,3.71,1240,SN-AX100-001
SENSOR-01,,43.1,2.40,19.0,3.69,1240,SN-AX100-001
SENSOR-02,,38.7,1.05,12.2,3.95,860,SN-AX100-002
"""


def log(message: str) -> None:
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{now}] {message}", flush=True)


def js_iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def coerce(value: str) -> Any:
    """Turn a CSV cell into a number when it looks numeric, else keep the string."""
    v = value.strip()
    if v == "":
        return None
    try:
        if "." in v or "e" in v.lower():
            return float(v)
        return int(v)
    except ValueError:
        return v


def row_to_payload(row: dict[str, str], device_override: str | None) -> dict[str, Any] | None:
    device_id = device_override or (row.get(DEVICE_ID_COLUMN) or "").strip()
    if not device_id:
        log(f"Row skipped — no '{DEVICE_ID_COLUMN}' value and no --device-id override.")
        return None

    timestamp = (row.get("timestamp") or "").strip() or js_iso_now()

    payload: dict[str, Any] = {"deviceId": device_id, "timestamp": timestamp}
    for key, raw in row.items():
        if key in (DEVICE_ID_COLUMN, "timestamp"):
            continue
        val = coerce(raw)
        if val is not None:
            payload[key] = val
    return payload


def post_payload(payload: dict[str, Any], dry_run: bool) -> bool:
    if dry_run:
        print(json.dumps(payload, indent=2), flush=True)
        return True

    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        ENDPOINT, data=body, method="POST",
        headers={"Content-Type": "application/json"},
    )
    ssl_context = None
    if ENDPOINT.lower().startswith("https") and not VERIFY_TLS:
        ssl_context = ssl._create_unverified_context()

    try:
        with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT_SECONDS, context=ssl_context) as resp:
            data = json.loads(resp.read() or b"{}")
            if resp.getcode() == 200:
                log(f"OK  deviceId={payload['deviceId']}  records={data.get('recordsWritten', '?')}  asset={data.get('assetName', '?')}")
                return True
            log(f"FAIL StatusCode={resp.getcode()}")
            return False
    except urllib.error.HTTPError as exc:
        log(f"FAIL StatusCode={exc.code}  {exc.read()[:200]!r}")
        return False
    except Exception as exc:
        log(f"Connection error: {exc}")
        return False


def push_file(path: Path, device_override: str | None, dry_run: bool) -> tuple[int, int]:
    with path.open(newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        if reader.fieldnames is None:
            log("CSV has no header row.")
            return 0, 0
        if DEVICE_ID_COLUMN not in reader.fieldnames and not device_override:
            log(f"CSV has no '{DEVICE_ID_COLUMN}' column. Add it, or pass --device-id.")
            return 0, 0

        ok = fail = 0
        for row in reader:
            payload = row_to_payload(row, device_override)
            if payload is None:
                fail += 1
                continue
            if post_payload(payload, dry_run):
                ok += 1
            else:
                fail += 1
        return ok, fail


def main() -> int:
    parser = argparse.ArgumentParser(description="Push CSV rows as telemetry to the ingest API.")
    parser.add_argument("--file", type=Path, default=DEFAULT_CSV, help="CSV file to push (default: sensor_data.csv)")
    parser.add_argument("--device-id", help="Override deviceId for every row (must match the asset identifier)")
    parser.add_argument("--dry-run", action="store_true", help="Print payloads instead of posting")
    parser.add_argument("--make-sample", action="store_true", help="Write a sample CSV matching the SENSOR template and exit")
    parser.add_argument("--loop", action="store_true", help="Keep re-pushing the file on an interval")
    parser.add_argument("--interval", type=int, default=10, help="Seconds between loop passes (default 10)")
    args = parser.parse_args()

    if args.make_sample:
        args.file.write_text(SAMPLE_CSV, encoding="utf-8")
        log(f"Wrote sample CSV -> {args.file.resolve()}")
        log("Edit deviceId to match your asset's identifier, then: python csv_pusher.py --file " + str(args.file))
        return 0

    if not args.file.exists():
        log(f"CSV not found: {args.file.resolve()}")
        log("Create one with: python csv_pusher.py --make-sample")
        return 1

    log(f"Endpoint: {ENDPOINT}")
    log(f"Pushing: {args.file.resolve()}")

    while True:
        ok, fail = push_file(args.file, args.device_id, args.dry_run)
        log(f"Done. {ok} pushed, {fail} failed.")
        if not args.loop:
            return 0 if fail == 0 else 1
        time.sleep(args.interval)


if __name__ == "__main__":
    raise SystemExit(main())
