from __future__ import annotations

from pathlib import Path

from fastapi.routing import APIRoute, APIWebSocketRoute

from app.main import app

REPOSITORY = Path(__file__).resolve().parents[2]
MATRIX = REPOSITORY / "docs/backend-ui-capability-matrix.md"
DISPOSITIONS = {"Covered", "Machine-owned", "Server-owned"}
HTTP_METHODS = {"delete", "get", "head", "options", "patch", "post", "put", "trace"}


def _matrix_rows() -> list[list[str]]:
    rows: list[list[str]] = []
    for line in MATRIX.read_text(encoding="utf-8").splitlines():
        if not line.startswith("| `"):
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        assert len(cells) == 4, f"capability row must have four columns: {line}"
        rows.append(cells)
    return rows


def _capability(cell: str) -> str:
    # The route contract is the first Markdown code span; prose such as the
    # replay mode may follow it without changing the backend route identity.
    parts = cell.split("`")
    assert len(parts) >= 3, f"capability must start with a code span: {cell}"
    return parts[1]


def _websocket_paths(router: object, prefix: str = "") -> set[str]:
    paths: set[str] = set()
    for route in getattr(router, "routes", ()):
        if isinstance(route, APIWebSocketRoute):
            paths.add(f"WS {prefix}{route.path}")
            continue
        included = getattr(route, "original_router", None)
        context = getattr(route, "include_context", None)
        if included is not None and context is not None:
            paths.update(
                _websocket_paths(included, f"{prefix}{getattr(context, 'prefix', '')}")
            )
    return paths


def _backend_capabilities() -> set[str]:
    # OpenAPI is authoritative for documented HTTP operations and gives us the
    # effective paths after nested router inclusion and shared dependencies.
    schema = app.openapi()
    capabilities = {
        f"{method.upper()} {path}"
        for path, operations in schema["paths"].items()
        for method in operations
        if method in HTTP_METHODS
    }
    # Probes deliberately excluded from OpenAPI still belong in the inventory.
    capabilities.update(
        f"{method} {route.path}"
        for route in app.routes
        if isinstance(route, APIRoute)
        and route.path in {"/livez", "/readyz", "/metrics"}
        for method in route.methods
    )
    capabilities.update(
        capability
        for capability in _websocket_paths(app.router)
        if not capability.startswith("WS /api/v1/")
    )
    return capabilities


def test_capability_matrix_matches_every_backend_route() -> None:
    rows = _matrix_rows()
    documented = {_capability(row[0]) for row in rows}
    actual = _backend_capabilities()

    assert documented == actual, (
        f"undocumented backend capabilities: {sorted(actual - documented)}; "
        f"stale matrix capabilities: {sorted(documented - actual)}"
    )


def test_capability_matrix_uses_explicit_dispositions() -> None:
    rows = _matrix_rows()
    assert rows, "capability matrix has no data rows"
    for capability, _integration, _affordance, disposition in rows:
        assert disposition in DISPOSITIONS, (
            f"{_capability(capability)} has unsupported disposition {disposition!r}"
        )
