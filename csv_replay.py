"""
CSV → Ingest *live replay* for large telemetry files (hundreds of thousands of rows).

Streams a CSV row-by-row (constant memory) and POSTs readings to the ingest API
at a controlled rate, so the dashboard / live feed / alarms react as if data were
arriving live. Designed for big files (e.g. 800k rows) — does NOT load the whole
file into memory and is resumable.

Why not the browser uploader?
  One POST per row × 800k = the tab freezes. And one-row-per-10s would take ~92 days.
  This script paces by rows/second and batches HTTP calls for throughput.

Linking rule (same as the platform):
  Each row is sent with a deviceId. For the data to show on an asset, that deviceId
  MUST equal the asset's identifier (and that asset should be created from your template).

CSV format (header row required):
  deviceId,timestamp,temperature,vibration_rms_velocity_x,ultrasound,battery,runhours,sensor_serial
  - deviceId column optional if you pass --device-id (applied to all rows).
  - timestamp column optional; by default each row is stamped with *now* (live feel).
  - every other column is a metric; header names should match the template tagNames.

Usage:
  python csv_replay.py --file big.csv --device-id SENSOR-01 --rate 50
  python csv_replay.py --file big.csv --rate 100 --batch 20
  python csv_replay.py --file big.csv --device-id SENSOR-01 --start 250000   # resume
  python csv_replay.py --file big.csv --device-id SENSOR-01 --use-csv-ts     # keep original timestamps
  python csv_replay.py --file big.csv --device-id SENSOR-01 --dry-run --limit 5

Rate guide (rows/sec → time for 800k):  20 → ~11h · 50 → ~4.5h · 200 → ~1.1h · 1000 → ~13m
Endpoint + TLS configured via env (same as the other scripts).
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

ENDPOINT_BASE = os.getenv("INGEST_BASE", "http://localhost:8080/api/ingest")
PAYLOAD_URL = ENDPOINT_BASE.rstrip("/") + "/payload"
BATCH_URL = ENDPOINT_BASE.rstrip("/") + "/batch"
HTTP_TIMEOUT_SECONDS = int(os.getenv("HTTP_TIMEOUT_SECONDS", "30"))
VERIFY_TLS = os.getenv("VERIFY_TLS", "false").lower() in {"1", "true", "yes"}
DEVICE_ID_COLUMN = os.getenv("DEVICE_ID_COLUMN", "deviceId")


def log(msg: str) -> None:
    now = datetime.now().strftime("%H:%M:%S")
    print(f"[{now}] {msg}", flush=True)


def js_iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def coerce(value: str) -> Any:
    v = value.strip()
    if v == "":
        return None
    try:
        return int(v) if ("." not in v and "e" not in v.lower()) else float(v)
    except ValueError:
        try:
            return float(v)
        except ValueError:
            return v


def make_ctx() -> ssl.SSLContext | None:
    if PAYLOAD_URL.lower().startswith("https") and not VERIFY_TLS:
        return ssl._create_unverified_context()
    return None


def post(url: str, body: Any, ctx) -> bool:
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST", headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_SECONDS, context=ctx) as resp:
            return resp.getcode() == 200
    except urllib.error.HTTPError as exc:
        log(f"HTTP {exc.code}: {exc.read()[:160]!r}")
        return False
    except Exception as exc:
        log(f"Connection error: {exc}")
        return False


def build_payload(row: dict[str, str], headers: list[str], device_override: str | None, use_csv_ts: bool) -> dict[str, Any] | None:
    device_id = device_override or (row.get(DEVICE_ID_COLUMN) or "").strip()
    if not device_id:
        return None
    timestamp = (row.get("timestamp") or "").strip() if use_csv_ts else ""
    payload: dict[str, Any] = {"deviceId": device_id, "timestamp": timestamp or js_iso_now()}
    for h in headers:
        if h == DEVICE_ID_COLUMN or h.lower() == "timestamp":
            continue
        v = coerce(row.get(h, ""))
        if v is not None:
            payload[h] = v
    return payload


def main() -> int:
    ap = argparse.ArgumentParser(description="Replay a large telemetry CSV to the ingest API at a controlled rate.")
    ap.add_argument("--file", type=Path, required=True, help="CSV file to replay")
    ap.add_argument("--device-id", help="deviceId applied to every row (must equal the asset identifier)")
    ap.add_argument("--rate", type=float, default=50, help="Target rows per second (default 50)")
    ap.add_argument("--batch", type=int, default=10, help="Rows per HTTP request via /ingest/batch; 1 = per-row /payload (default 10)")
    ap.add_argument("--start", type=int, default=0, help="Skip this many rows first (resume)")
    ap.add_argument("--limit", type=int, default=0, help="Stop after this many rows (0 = all)")
    ap.add_argument("--use-csv-ts", action="store_true", help="Keep the CSV timestamp column instead of stamping now")
    ap.add_argument("--dry-run", action="store_true", help="Print payloads instead of posting")
    args = ap.parse_args()

    if not args.file.exists():
        log(f"File not found: {args.file.resolve()}")
        return 1

    ctx = make_ctx()
    url = PAYLOAD_URL if args.batch <= 1 else BATCH_URL
    per_row = 1.0 / args.rate if args.rate > 0 else 0.0

    log(f"Replaying {args.file.name}  ->  {url}")
    log(f"rate={args.rate}/s  batch={args.batch}  start={args.start}  ts={'csv' if args.use_csv_ts else 'now'}")

    sent = ok = fail = 0
    buf: list[dict[str, Any]] = []
    t0 = time.time()
    window_start = time.time()

    def flush() -> None:
        nonlocal ok, fail, window_start
        if not buf:
            return
        if args.dry_run:
            for p in buf:
                print(json.dumps(p), flush=True)
            ok += len(buf)
        elif args.batch <= 1:
            for p in buf:
                if post(url, p, ctx):
                    ok += 1
                else:
                    fail += 1
        else:
            if post(url, buf, ctx):
                ok += len(buf)
            else:
                fail += len(buf)
        # Pace: ensure this batch took at least len(buf) * per_row seconds.
        if per_row > 0:
            target = len(buf) * per_row
            elapsed = time.time() - window_start
            if elapsed < target:
                time.sleep(target - elapsed)
        window_start = time.time()
        buf.clear()

    try:
        with args.file.open(newline="", encoding="utf-8-sig") as fh:
            reader = csv.DictReader(fh)
            if reader.fieldnames is None:
                log("CSV has no header row.")
                return 1
            headers = list(reader.fieldnames)
            if DEVICE_ID_COLUMN not in headers and not args.device_id:
                log(f"No '{DEVICE_ID_COLUMN}' column and no --device-id. Aborting.")
                return 1

            for i, row in enumerate(reader):
                if i < args.start:
                    continue
                if args.limit and sent >= args.limit:
                    break
                payload = build_payload(row, headers, args.device_id, args.use_csv_ts)
                if payload is None:
                    fail += 1
                    continue
                buf.append(payload)
                sent += 1
                if len(buf) >= args.batch:
                    flush()
                if sent % 5000 == 0:
                    rate = sent / max(time.time() - t0, 0.001)
                    log(f"progress: {sent} sent ({ok} ok, {fail} fail) ~{rate:.0f}/s")
            flush()
    except KeyboardInterrupt:
        flush()
        log(f"Interrupted. Resume with: --start {args.start + sent}")
        return 130

    dur = time.time() - t0
    log(f"Done. {sent} rows in {dur:.0f}s ({ok} ok, {fail} fail, ~{sent/max(dur,0.001):.0f}/s)")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
