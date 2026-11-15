import argparse
import fcntl
import json
import os
import shlex
import struct
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

LIRC_SET_SEND_MODE = 0x40046911
LIRC_SET_SEND_CARRIER = 0x40046913
LIRC_SET_SEND_DUTY_CYCLE = 0x40046915
LIRC_SET_TRANSMITTER_MASK = 0x40046917
LIRC_MODE_PULSE = 2

BASE = Path(__file__).resolve().parent.parent
DOCS = BASE / "docs"
ARGS = None


def elevate():
    if os.geteuid() == 0:
        return
    cmd = shlex.join([sys.executable, str(Path(__file__).resolve())] + sys.argv[1:])
    try:
        os.execvp("su", ["su", "-c", cmd])
    except FileNotFoundError:
        sys.exit("su tidak ditemukan, jalankan sebagai root")


def ir_send(device, carrier, duty, values):
    values = [int(v) for v in values]
    if not values or any(v <= 0 for v in values):
        raise ValueError("pulses tidak valid")
    if len(values) % 2 == 0:
        values.append(1)
    payload = struct.pack("<%dI" % len(values), *values)
    fd = os.open(device, os.O_RDWR)
    try:
        fcntl.ioctl(fd, LIRC_SET_SEND_MODE, struct.pack("I", LIRC_MODE_PULSE))
        fcntl.ioctl(fd, LIRC_SET_SEND_CARRIER, struct.pack("I", int(carrier)))
        fcntl.ioctl(fd, LIRC_SET_SEND_DUTY_CYCLE, struct.pack("I", int(duty)))
        try:
            fcntl.ioctl(fd, LIRC_SET_TRANSMITTER_MASK, struct.pack("I", 0xFFFFFFFF))
        except OSError:
            pass
        return os.write(fd, payload)
    finally:
        os.close(fd)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DOCS), **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()

    def do_POST(self):
        if urlparse(self.path).path != "/ir":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            data = json.loads(self.rfile.read(length) or b"{}")
            freq = int(data.get("freq", 38000))
            pulses = data.get("pulses", [])
            written = ir_send(ARGS.device, freq, ARGS.duty, pulses)
            body = json.dumps({"ok": True, "count": len(pulses), "written": written}).encode()
            self.send_response(200)
        except Exception as exc:
            body = json.dumps({"ok": False, "error": str(exc)}).encode()
            self.send_response(500)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        sys.stderr.write((fmt % args) + "\n")


def main():
    global ARGS
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--device", default="/dev/lirc0")
    parser.add_argument("--duty", type=int, default=50)
    parser.add_argument("--no-root", action="store_true")
    ARGS = parser.parse_args()
    if not ARGS.no_root:
        elevate()
    server = ThreadingHTTPServer(("0.0.0.0", ARGS.port), Handler)
    print(f"http://127.0.0.1:{ARGS.port}/   device={ARGS.device}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
