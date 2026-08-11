from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/seed_demo.py"
SPEC = importlib.util.spec_from_file_location("seed_demo", SCRIPT)
assert SPEC and SPEC.loader
seed_demo = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(seed_demo)


def test_seed_demo_uses_authenticated_bounded_replays_and_requires_alerts(
    monkeypatch: Any,
) -> None:
    calls: list[tuple[str, dict[str, Any] | None, str | None]] = []
    replay_status = {"status": "completed", "processed": 2, "total": 2}

    def fake_request(
        _base_url: str,
        path: str,
        *,
        payload: dict[str, Any] | None = None,
        token: str | None = None,
    ) -> Any:
        calls.append((path, payload, f"Bearer {token}" if token else None))
        if path == "/auth/login":
            return {"access_token": "demo-token"}
        if path == "/alerts":
            return [{"id": "alert-1"}]
        return replay_status

    monkeypatch.setattr(seed_demo, "request_json", fake_request)
    alerts = seed_demo.seed_demo("http://127.0.0.1:8000", "admin", "password", 2)

    assert alerts == 1
    starts = [call for call in calls if call[0].endswith("/replay/start")]
    assert [call[1]["scenario"] for call in starts] == ["normal", "attack"]
    assert all(call[1]["limit"] == 2 and call[1]["speed"] == 100 for call in starts)
    assert all(call[2] == "Bearer demo-token" for call in starts)
    alerts_call = next(call for call in calls if call[0] == "/alerts")
    assert alerts_call[2] == "Bearer demo-token"
