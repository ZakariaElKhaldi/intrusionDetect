from __future__ import annotations

import argparse
import time
from datetime import datetime

from sqlalchemy import select

from app.config import Settings
from app.database.models import Alert
from app.database.session import create_engine_and_session


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify a deterministic lab alert")
    parser.add_argument("signature_id", type=int)
    parser.add_argument("--after", required=True)
    parser.add_argument("--timeout", type=float, default=5.0)
    args = parser.parse_args()
    after = datetime.fromisoformat(args.after.replace("Z", "+00:00"))
    settings = Settings.from_env()
    engine, session_factory = create_engine_and_session(settings.database_url)
    deadline = time.monotonic() + args.timeout
    try:
        while time.monotonic() <= deadline:
            with session_factory() as session:
                alert = session.scalar(
                    select(Alert)
                    .where(Alert.detection_source == "suricata")
                    .where(Alert.signature_id == args.signature_id)
                    .where(Alert.occurred_at >= after)
                    .order_by(Alert.occurred_at.desc())
                    .limit(1)
                )
                if alert is not None:
                    print(
                        f"Verified Suricata rule {args.signature_id}: "
                        f"{alert.network_context} at {alert.occurred_at.isoformat()}",
                        flush=True,
                    )
                    return 0
            time.sleep(0.2)
    finally:
        engine.dispose()
    print(f"No Suricata rule {args.signature_id} alert arrived within {args.timeout:.1f}s")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
