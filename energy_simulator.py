from __future__ import annotations

import argparse
import json
import os
import random
import signal
import ssl
import sys
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Configuration copied from the Node-RED flow
# ---------------------------------------------------------------------------

# Same deviceId used in the Node-RED Device Id subflow.
DEVICE_ID = os.getenv("DEVICE_ID", "testing")

# Same REST endpoint used in the Node-RED AHI Rest API POST subflow.
ENDPOINT = os.getenv(
    "ENDPOINT",
"http://localhost:5173/api/ingest/payload")

# Same buffer size used by the Node-RED Buffer-AM subflow.
BUFFER_SIZE = int(os.getenv("BUFFER_SIZE", "50000"))

# Same generation interval as the Node-RED "Energy KPIs" inject node.
ENERGY_INTERVAL_SECONDS = int(os.getenv("ENERGY_INTERVAL_SECONDS", "60"))

# Same scheduled sender interval as the Node-RED "Inject once" node.
POST_INTERVAL_SECONDS = int(os.getenv("POST_INTERVAL_SECONDS", "300"))

# Same retry delay as the Node-RED delay node after failed REST post.
RETRY_DELAY_SECONDS = int(os.getenv("RETRY_DELAY_SECONDS", "1"))

# Same timeout as the Node-RED REST function node.
HTTP_TIMEOUT_SECONDS = int(os.getenv("HTTP_TIMEOUT_SECONDS", "30"))

# Node-RED used rejectUnauthorized=false.
# Keep this False to behave like the flow, but use True in production when possible.
VERIFY_TLS = os.getenv("VERIFY_TLS", "false").lower() in {"1", "true", "yes"}

# Local persistent buffer file.
BUFFER_FILE = Path(os.getenv("BUFFER_FILE", "energy_buffer.json"))

# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

def log(message: str) -> None:
    """Print a timestamped log message."""
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{now}] {message}", flush=True)

def js_iso_now() -> str:
    """
    Return a timestamp similar to JavaScript new Date().toISOString().
    Example: 2026-06-22T10:15:30.123Z
    """
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")

def timestamp_unix_ms() -> int:
    """Return current Unix timestamp in milliseconds, same as JavaScript Date.now()."""
    return int(time.time() * 1000)

def rand(min_value: float, max_value: float, decimals: int = 2) -> float:
    """
    Match the Node-RED JavaScript helper:
    +((Math.random() * (max - min) + min).toFixed(decimals))
    """
    return round(random.random() * (max_value - min_value) + min_value, decimals)

# ---------------------------------------------------------------------------
# Energy Simulation node replacement
# ---------------------------------------------------------------------------

def generate_energy_payload() -> dict[str, Any]:
    """
    Python version of the Node-RED "Energy Simulation" function node.
    It creates simulated KPI values for chiller, lighting, elevator, genset,
    fire alarm, solar, and grid.
    """
    now = js_iso_now()

    # Chiller system values.
    chiller = {
        "energy_kWh": rand(12, 20),
        "load_percent": rand(65, 100),
        "COP": rand(2.5, 4.5),
        "flow_rate_lps": rand(30, 60),
    }

    # Lighting system values.
    lighting = {
        "energy_kWh": rand(3, 7),
        "zone_usage": rand(50, 100),
        "power_factor": rand(0.85, 1.0),
    }

    # Elevator values.
    elevator = {
        "energy_kWh": rand(1, 3),
        "trip_count": int(rand(5, 20) // 1),
        "idle_time_min": rand(5, 30),
    }

    # Diesel Generator values.
    genset = {
        "energy_kWh": rand(0, 6),
        "fuel_liters": rand(0, 2),
        "efficiency_kWh_per_l": rand(2, 3),
    }

    # Fire Alarm values.
    fire_alarm = {
        "energy_kWh": rand(0.3, 0.8),
        "alarm_triggered": random.random() < 0.1,
        "standby_power_W": rand(10, 25),
    }

    # Solar generation logic.
    # The Node-RED flow used the local system hour.
    hour = datetime.now().hour
    irradiance = rand(400, 1000) if 6 <= hour <= 18 else 0
    solar_kWh = rand(5, 15) if irradiance else 0

    solar = {
        "generated_kWh": solar_kWh,
        "irradiance_Wm2": irradiance,
        "efficiency_percent": rand(15, 20),
    }

    # Total demand calculation.
    total_kWh = (
        chiller["energy_kWh"]
        + lighting["energy_kWh"]
        + elevator["energy_kWh"]
        + genset["energy_kWh"]
        + fire_alarm["energy_kWh"]
    )

    # Grid supply calculation.
    grid_kWh = round(max(0, total_kWh - solar["generated_kWh"]), 2)
    tariff = 7.2

    grid = {
        "consumed_kWh": grid_kWh,
        "tariff_INR_kWh": tariff,
        "cost_INR": round(grid_kWh * tariff, 2),
    }

    return {
        "timestamp": now,
        "chiller": chiller,
        "lighting": lighting,
        "elevator": elevator,
        "genset": genset,
        "fire_alarm": fire_alarm,
        "solar": solar,
        "grid": grid,
    }

# ---------------------------------------------------------------------------
# Device Id - AM subflow replacement
# ---------------------------------------------------------------------------

def add_device_metadata(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Python version of the Node-RED "Device Id - AM" subflow.

    Important:
    The Node-RED code builds device metadata first and then merges the original
    payload over it. Because the simulated payload already has "timestamp",
    that simulated timestamp remains the final timestamp.
    """
    metadata = {
        "deviceId": DEVICE_ID,
        "timestamp": js_iso_now(),
        "timestampUnix": timestamp_unix_ms(),
    }

    # This order matches JavaScript:
    # fullData = { ...data, ...msg.payload }
    return {**metadata, **payload}

# ---------------------------------------------------------------------------
# Buffer - AM subflow replacement
# ---------------------------------------------------------------------------

@dataclass
class PersistentBuffer:
    """
    A disk-backed buffer similar to the Node-RED Buffer-AM subflow.

    Node-RED behavior:
    - topic="add" inserts new data at the beginning of the array.
    - if max size is reached, the last item is removed.
    - REST sender posts the last item, so oldest messages are sent first.
    """

    file_path: Path
    max_size: int
    items: list[dict[str, Any]] = field(default_factory=list)
    lock: threading.Lock = field(default_factory=threading.Lock)

    def load(self) -> None:
        """Load existing buffer from disk."""
        with self.lock:
            if not self.file_path.exists():
                self.items = []
                return

            try:
                data = json.loads(self.file_path.read_text(encoding="utf-8"))
                self.items = data if isinstance(data, list) else []
                log(f"Loaded buffer from disk. Buffer: {len(self.items)}")
            except Exception as exc:
                log(f"Could not read buffer file. Starting with empty buffer. Error: {exc}")
                self.items = []

    def save(self) -> None:
        """Save buffer to disk atomically (Windows-safe)."""
        # Per-process temp name so two running instances don't clobber each other.
        temp_file = self.file_path.with_suffix(f".{os.getpid()}.tmp")
        payload = json.dumps(self.items, indent=2)
        temp_file.write_text(payload, encoding="utf-8")
        # os.replace can fail on Windows (WinError 5) when the target is briefly
        # locked by antivirus/indexer/another reader — retry, then fall back.
        last_exc: Exception | None = None
        for _ in range(5):
            try:
                os.replace(temp_file, self.file_path)
                return
            except PermissionError as exc:
                last_exc = exc
                time.sleep(0.2)
        try:
            self.file_path.write_text(payload, encoding="utf-8")
            temp_file.unlink(missing_ok=True)
        except Exception:
            if last_exc:
                raise last_exc

    def add(self, payload: dict[str, Any]) -> None:
        """Add new message at the beginning of the buffer."""
        with self.lock:
            if len(self.items) >= self.max_size:
                self.items.pop()

            self.items.insert(0, payload)
            self.save()
            log(f"Added message to buffer. Buffer: {len(self.items)}")

    def remove(self, payload: dict[str, Any]) -> bool:
        """Remove one successfully sent message from the buffer."""
        with self.lock:
            try:
                self.items.remove(payload)
                self.save()
                log(f"Removed sent message from buffer. Buffer: {len(self.items)}")
                return True
            except ValueError:
                log("Sent message was not found in buffer. Nothing removed.")
                return False

    def clear(self) -> None:
        """Clear all buffered messages."""
        with self.lock:
            self.items = []
            self.save()
            log("Buffer cleared. Buffer: 0")

    def oldest(self) -> dict[str, Any] | None:
        """Return the oldest message, matching Node-RED slice(-1)."""
        with self.lock:
            if not self.items:
                return None
            return self.items[-1]

    def size(self) -> int:
        """Return current buffer length."""
        with self.lock:
            return len(self.items)

# ---------------------------------------------------------------------------
# AHI Rest API POST subflow replacement
# ---------------------------------------------------------------------------

def post_payload(payload: dict[str, Any], dry_run: bool = False) -> bool:
    """
    Python version of the Node-RED REST POST subflow.

    Node-RED success condition:
    - Only HTTP 200 is treated as success.
    """
    if dry_run:
        log("Dry-run mode enabled. Payload not posted.")
        print(json.dumps(payload, indent=2), flush=True)
        return True

    body = json.dumps(payload).encode("utf-8")

    request = urllib.request.Request(
        ENDPOINT,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json"},
    )

    ssl_context = None
    if ENDPOINT.lower().startswith("https") and not VERIFY_TLS:
        ssl_context = ssl._create_unverified_context()

    try:
        with urllib.request.urlopen(
            request,
            timeout=HTTP_TIMEOUT_SECONDS,
            context=ssl_context,
        ) as response:
            status_code = response.getcode()

            if status_code == 200:
                log(f"Message Post Success, StatusCode: {status_code}")
                return True

            log(f"Message Post Failed, StatusCode: {status_code}")
            return False

    except urllib.error.HTTPError as exc:
        log(f"Message Post Failed, StatusCode: {exc.code}")
        return False
    except Exception as exc:
        log(f"Connection error: {exc}")
        return False

# ---------------------------------------------------------------------------
# Flow orchestration
# ---------------------------------------------------------------------------

def generate_and_buffer_once(buffer: PersistentBuffer) -> dict[str, Any]:
    """
    Perform one complete generation path:
    Energy Simulation -> Data to IS/topic add -> Device Id -> Buffer-AM add.
    """
    energy_payload = generate_energy_payload()
    final_payload = add_device_metadata(energy_payload)
    buffer.add(final_payload)
    return final_payload

def send_buffer_until_empty(buffer: PersistentBuffer, dry_run: bool = False) -> None:
    """
    Send buffered messages until the buffer is empty.

    Behavior matches the Node-RED flow:
    - Post oldest message.
    - If success, remove it and continue with the next buffered message.
    - If fail, wait 1 second and retry.
    """
    while True:
        payload = buffer.oldest()

        if payload is None:
            log("Send fail or message empty! Buffer is empty.")
            return

        success = post_payload(payload, dry_run=dry_run)

        if success:
            buffer.remove(payload)
            continue

        log(f"Retrying after {RETRY_DELAY_SECONDS} second(s).")
        time.sleep(RETRY_DELAY_SECONDS)

def generator_loop(buffer: PersistentBuffer, stop_event: threading.Event) -> None:
    """Run the Energy KPI generator once immediately and then every 60 seconds."""
    while not stop_event.is_set():
        generate_and_buffer_once(buffer)

        if stop_event.wait(ENERGY_INTERVAL_SECONDS):
            break

def sender_loop(buffer: PersistentBuffer, stop_event: threading.Event, dry_run: bool = False) -> None:
    """
    Start sender once after 5 seconds, then every 300 seconds.

    This matches the Node-RED sender inject node:
    - onceDelay: 5 seconds
    - repeat: 300 seconds
    """
    if stop_event.wait(5):
        return

    while not stop_event.is_set():
        send_buffer_until_empty(buffer, dry_run=dry_run)

        if stop_event.wait(POST_INTERVAL_SECONDS):
            break

def run_forever(dry_run: bool = False) -> None:
    """Run the full Python flow continuously."""
    buffer = PersistentBuffer(BUFFER_FILE, BUFFER_SIZE)
    buffer.load()

    stop_event = threading.Event()

    def stop_handler(signum: int, frame: Any) -> None:
        log("Stop signal received. Closing flow.")
        stop_event.set()

    signal.signal(signal.SIGINT, stop_handler)
    signal.signal(signal.SIGTERM, stop_handler)

    generator_thread = threading.Thread(
        target=generator_loop,
        args=(buffer, stop_event),
        name="energy-generator",
        daemon=True,
    )

    sender_thread = threading.Thread(
        target=sender_loop,
        args=(buffer, stop_event, dry_run),
        name="rest-sender",
        daemon=True,
    )

    log("Python flow started.")
    log(f"Device ID: {DEVICE_ID}")
    log(f"Endpoint: {ENDPOINT}")
    log(f"Buffer file: {BUFFER_FILE.resolve()}")
    log(f"Buffer size limit: {BUFFER_SIZE}")

    generator_thread.start()
    sender_thread.start()

    while not stop_event.is_set():
        time.sleep(0.5)

    generator_thread.join(timeout=5)
    sender_thread.join(timeout=5)
    log("Python flow stopped.")

def main() -> int:
    """Command-line entry point."""
    parser = argparse.ArgumentParser(description="Python version of the Node-RED energy data flow.")
    parser.add_argument("--once", action="store_true", help="Generate one message and try to send buffer once.")
    parser.add_argument("--dry-run", action="store_true", help="Print payload instead of posting to the API.")
    parser.add_argument("--clear-buffer", action="store_true", help="Clear the persistent local buffer and exit.")

    args = parser.parse_args()

    buffer = PersistentBuffer(BUFFER_FILE, BUFFER_SIZE)
    buffer.load()

    if args.clear_buffer:
        buffer.clear()
        return 0

    if args.once:
        generate_and_buffer_once(buffer)
        send_buffer_until_empty(buffer, dry_run=args.dry_run)
        return 0

    run_forever(dry_run=args.dry_run)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
