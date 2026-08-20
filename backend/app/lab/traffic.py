from __future__ import annotations

import argparse
import json
import socket
import struct
import time
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import urlopen


def _mqtt_string(value: str) -> bytes:
    encoded = value.encode("utf-8")
    return struct.pack("!H", len(encoded)) + encoded


def _remaining_length(value: int) -> bytes:
    encoded = bytearray()
    while True:
        digit = value % 128
        value //= 128
        if value:
            digit |= 0x80
        encoded.append(digit)
        if not value:
            return bytes(encoded)


def mqtt_connect(
    host: str, *, client_id: str, username: str, password: str
) -> socket.socket:
    variable = _mqtt_string("MQTT") + bytes([4, 0xC2]) + struct.pack("!H", 30)
    payload = _mqtt_string(client_id) + _mqtt_string(username) + _mqtt_string(password)
    packet = bytes([0x10]) + _remaining_length(len(variable) + len(payload)) + variable + payload
    connection = socket.create_connection((host, 1883), timeout=3)
    connection.sendall(packet)
    reply = connection.recv(4)
    if len(reply) != 4 or reply[0] != 0x20 or reply[3] != 0:
        connection.close()
        raise ConnectionError(f"MQTT broker rejected connection with {reply.hex()}")
    return connection


def mqtt_publish(connection: socket.socket, topic: str, message: str) -> None:
    body = _mqtt_string(topic) + message.encode("utf-8")
    connection.sendall(bytes([0x30]) + _remaining_length(len(body)) + body)


def run_temperature_sensor() -> None:
    while True:
        try:
            connection = mqtt_connect(
                "mqtt-broker",
                client_id="temperature-sensor-01",
                username="lab-device",
                password="lab-password",
            )
            while True:
                reading = {
                    "device": "temperature-sensor-01",
                    "celsius": 21.5 + (int(time.time()) % 20) / 10,
                    "observed_at": datetime.now(UTC).isoformat(),
                }
                mqtt_publish(connection, "lab/sensors/temperature", json.dumps(reading))
                time.sleep(2)
        except (OSError, ConnectionError) as error:
            print(f"temperature publisher reconnecting: {error}", flush=True)
            time.sleep(2)


class CameraHandler(BaseHTTPRequestHandler):
    server_version = "IoTLabCamera/1.0"

    def do_GET(self) -> None:  # noqa: N802 - standard library handler contract
        payload = json.dumps(
            {
                "device": "camera-01",
                "status": "online",
                "path": self.path,
                "observed_at": datetime.now(UTC).isoformat(),
            }
        ).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format: str, *args: object) -> None:
        print(f"camera-api: {format % args}", flush=True)


def run_camera() -> None:
    ThreadingHTTPServer(("0.0.0.0", 8081), CameraHandler).serve_forever()


def run_normal() -> None:
    with urlopen("http://camera-api:8081/status", timeout=3) as response:
        print(response.read().decode(), flush=True)
    connection = mqtt_connect(
        "mqtt-broker",
        client_id="presentation-check",
        username="lab-device",
        password="lab-password",
    )
    mqtt_publish(connection, "lab/presentation/check", "normal-traffic-ok")
    connection.close()
    print("Normal HTTP and MQTT traffic generated.", flush=True)


def run_scan() -> None:
    targets = ("mqtt-broker", "camera-api")
    ports = (21, 22, 23, 53, 80, 443, 554, 1883, 8081, 8883, 9000)
    for target in targets:
        address = socket.gethostbyname(target)
        for port in ports:
            with socket.socket() as probe:
                probe.settimeout(0.15)
                result = probe.connect_ex((address, port))
            print(f"scan {address}:{port} {'open' if result == 0 else 'closed'}")
    print("Confined TCP service scan completed.", flush=True)


def run_mqtt_attack() -> None:
    for attempt in range(12):
        try:
            mqtt_connect(
                "mqtt-broker",
                client_id=f"lab-attacker-{attempt}",
                username="lab-attacker",
                password="invalid-password",
            ).close()
        except (OSError, ConnectionError):
            pass
        time.sleep(0.1)
    print("Confined rejected MQTT authentication burst completed.", flush=True)


def run_web_attack() -> None:
    with urlopen("http://camera-api:8081/firmware/debug-shell?command=id", timeout=3) as response:
        response.read()
    print("Confined suspicious camera request completed.", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="IoT cyber-range traffic generator")
    parser.add_argument(
        "mode",
        choices=("camera", "temperature", "normal", "scan", "mqtt-attack", "web-attack"),
    )
    mode = parser.parse_args().mode
    {
        "camera": run_camera,
        "temperature": run_temperature_sensor,
        "normal": run_normal,
        "scan": run_scan,
        "mqtt-attack": run_mqtt_attack,
        "web-attack": run_web_attack,
    }[mode]()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
