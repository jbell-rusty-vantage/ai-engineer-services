#!/usr/bin/env python3
"""./dev: one front door for a coding agent working on the AI Engineer service.

Modelled on the AI Engineer database contract's ./dev and Mission Control's (SPEC-03 K2). Every
input is a flag, JSON on stdout where a result is data, typed exit codes, and an error names the
fix. Standard library only, so ``./dev status`` and ``./dev doctor`` run before ``pnpm install``.
Nothing here opens a database session except ``./dev db`` (read-only, ``--plane`` required);
``status`` only checks whether loopback ports accept a connection.

  ./dev status                  orient in one call (JSON): branch, ahead/behind, dirty files, the
                                database contract it consumes (unpinned today), the database target
                                an unconfigured start binds to, which local services answer
  ./dev doctor                  read-only readiness (JSON); each failure names its fix
  ./dev check                   the fast gate: pnpm typecheck, pnpm test, pnpm lint, then
                                planes.py planes check and the provenance check
                                (trace.py check --range <upstream>..HEAD, warn-only)
  ./dev test unit|surface       pnpm test | pnpm build + pnpm eval:consumer-surface --without-database
  ./dev trace show|build|check|linear pull   the provenance chain (docs/tools/trace.py)
  ./dev hooks install|status    the warn-only commit-msg hook (scripts/dev/hooks/commit-msg)
  ./dev planes list|show P|check            the data-plane registry config/planes.toml (no network)
  ./dev db status|schema|query --plane P    read-only database sessions (scripts/dev/planes.py)

Exit codes: 0 ok, 1 a check or test failed, 2 usage error, 3 the environment is not ready,
4 refused by policy (``./dev db``).
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import socket
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TRACE = ROOT / "docs" / "tools" / "trace.py"
PLANES = ROOT / "scripts" / "dev" / "planes.py"
HOOK_MARKER = "# aieng-service-provenance-managed-v1"
WORKSPACE_ROOT = ROOT.parents[1]
DB_CONTRACT = ROOT.parent / "ai-engineer-db-contract"
REVIEW_WORKSPACE = WORKSPACE_ROOT / "platform" / "ai-engineer-research-2026-11-02" / "10-review-workspace"
ENTRYPOINTS = ["AGENTS.md", "features/README.md", "docs/ENVIRONMENT.md", "README.md"]
SIBLINGS = {
    "ai-engineer-db-contract": DB_CONTRACT,
    "review-workspace": REVIEW_WORKSPACE,
    "mission-control": WORKSPACE_ROOT / "platform" / "mission-control",
}
LOOPBACK = {"127.0.0.1", "localhost", "[::1]", "::1"}
CHECK_STEPS = [
    ("typecheck", ["pnpm", "typecheck"]),
    ("test", ["pnpm", "test"]),
    ("lint", ["pnpm", "lint"]),
]
TEST_LAYERS = {
    "unit": [["pnpm", "test"]],
    "surface": [["pnpm", "build"], ["pnpm", "eval:consumer-surface", "--without-database"]],
}


def git(*args: str) -> str:
    done = subprocess.run(
        ["git", *args],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    return done.stdout.rstrip() if done.returncode == 0 else ""  # keep porcelain leading spaces


def emit(data: object) -> None:
    print(json.dumps(data, indent=2, ensure_ascii=False))


def fail(message: str, fix: str, code: int = 2) -> int:
    print(f"dev: {message}\n  fix: {fix}", file=sys.stderr)
    return code


def resolve(command: list[str]) -> list[str]:
    """pnpm and node are .cmd shims on Windows; resolve the executable so no shell is needed."""

    found = shutil.which(command[0])
    return [found or command[0], *command[1:]]


def run(command: list[str]) -> int:
    print(f"$ {' '.join(command)}", file=sys.stderr, flush=True)
    try:
        return subprocess.run(resolve(command), cwd=ROOT, check=False).returncode
    except FileNotFoundError:
        print(f"dev: {command[0]} is not on PATH (./dev doctor)", file=sys.stderr)
        return 127


def upstream() -> str:
    return git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")


def hooks_dir() -> Path:
    path = Path(git("rev-parse", "--git-path", "hooks") or ".git/hooks")
    return path if path.is_absolute() else ROOT / path


def hook_state() -> str:
    hook = hooks_dir() / "commit-msg"
    if not hook.is_file():
        return "absent"
    text = hook.read_text(encoding="utf-8", errors="replace")
    return "managed" if HOOK_MARKER in text else "unmanaged"


def read_json(path: Path) -> dict[str, object] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


# ------------------------------------------------------------------------------------- status


def contract() -> dict[str, object]:
    """The database contract this service consumes. No version is pinned in this repository: the
    service calls whatever the target database runs, and an operation it lacks answers NOT_AVAILABLE."""

    workspace_dir = Path(os.environ.get("AIENG_SCHEMA_WORKSPACE_DIR") or DB_CONTRACT / "workspace")
    fingerprint = read_json(workspace_dir / "fingerprint.json") or {}
    inputs = fingerprint.get("inputs") if isinstance(fingerprint.get("inputs"), dict) else {}
    sibling = read_json(DB_CONTRACT / "contract.version.json") or {}
    return {
        "pinned": "unpinned",
        "schema_workspace": {
            "path": str(workspace_dir),
            "present": workspace_dir.is_dir(),
            "contract_version": inputs.get("contract_version"),  # type: ignore[union-attr]
            "migration_head": inputs.get("migration_head"),  # type: ignore[union-attr]
        },
        "sibling_checkout_version": sibling.get("version"),
    }


def env_lab_url() -> str | None:
    """AIENG_DB_URL from .env.lab, read only to classify its host; never printed."""

    path = ROOT / ".env.lab"
    if not path.is_file():
        return None
    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip().removeprefix("export ")
        if line.startswith("AIENG_DB_URL="):
            return line.split("=", 1)[1].strip().strip("\"'") or None
    return None


def database_target() -> dict[str, object]:
    url = env_lab_url()
    host = url.split("://", 1)[-1].split("/", 1)[0].rsplit(":", 1)[0] if url else None
    loopback = host in LOOPBACK if host else None
    return {
        "env_file": ".env.lab" if (ROOT / ".env.lab").is_file() else None,
        "env_lab_is_loopback": loopback,
        "unconfigured_start": (
            "binds to the loopback lab (.env.lab)"
            if loopback
            else "refuses (MISSING_ENVIRONMENT or REMOTE_DATABASE_NOT_CONFIRMED)"
        ),
        "remote": "only with AIENG_DB_REMOTE_CONFIRM=<project ref> (docs/ENVIRONMENT.md)",
        "repo_env_loaded_by_scripts": False,
    }


def answers(port: int, health: bool) -> str:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.4):
            pass
    except OSError:
        return "closed"
    if not health:
        return "open"
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=1.5) as response:
            return "healthy" if response.status == 200 else f"http {response.status}"
    except (urllib.error.URLError, OSError):
        return "open (no /health)"


def local_services() -> dict[str, dict[str, object]]:
    api = int(os.environ.get("AIENG_API_PORT") or 3200)
    mcp = int(os.environ.get("AIENG_MCP_PORT") or 3201)
    probes = {
        "api": (api, True),
        "mcp-remote": (mcp, True),
        "lab-api (lab-aieng-build04)": (55621, False),
        "lab-postgres (lab-aieng-build04)": (55622, False),
    }
    return {name: {"port": port, "state": answers(port, health)} for name, (port, health) in probes.items()}


def status() -> int:
    up = upstream()
    ahead = behind = None
    if up:
        counts = git("rev-list", "--left-right", "--count", f"{up}...HEAD").split()
        if len(counts) == 2:
            behind, ahead = int(counts[0]), int(counts[1])
    porcelain = [line for line in git("status", "--porcelain").splitlines() if line]
    target = database_target()
    snapshot = ROOT / ".sdlc" / "trace" / "linear-snapshot.json"
    hints = []
    if ahead:
        hints.append(f"{ahead} commit(s) not pushed to {up}")
    if not (ROOT / "node_modules").is_dir():
        hints.append("node_modules is absent: pnpm install --frozen-lockfile")
    if target["env_file"] is None:
        hints.append("no .env.lab: copy .env.example and fill it from the lab (docs/ENVIRONMENT.md)")
    elif target["env_lab_is_loopback"] is False:
        hints.append(".env.lab names a non-loopback AIENG_DB_URL; it is meant for the lab only")
    if hook_state() != "managed":
        hints.append("the provenance commit-msg hook is not installed: `./dev hooks install`")
    if not snapshot.is_file():
        hints.append("no Linear snapshot: OVE ids are checked for shape only (`./dev trace linear pull`)")
    emit(
        {
            "repo": "ai-engineer-service",
            "branch": git("branch", "--show-current"),
            "head": git("log", "-1", "--format=%h %s"),
            "upstream": up or None,
            "ahead": ahead,
            "behind": behind,
            "dirty": {
                "modified": sum(1 for line in porcelain if not line.startswith("??")),
                "untracked": sum(1 for line in porcelain if line.startswith("??")),
                "files": [line[3:] for line in porcelain[:40]],
                "truncated": len(porcelain) > 40,
            },
            "contract": contract(),
            "database_target": target,
            "local_services": local_services(),
            "hooks": {"commit-msg": hook_state(), "dir": str(hooks_dir())},
            "trace": {"linear_snapshot": snapshot.is_file()},
            "siblings": {name: path.is_dir() for name, path in SIBLINGS.items()},
            "entrypoints": ENTRYPOINTS,
            "hints": hints,
        }
    )
    return 0


# ------------------------------------------------------------------------------------- doctor


def version_of(command: list[str]) -> str | None:
    try:
        done = subprocess.run(
            resolve(command), capture_output=True, text=True, timeout=20, check=False, cwd=ROOT
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None
    return (done.stdout or done.stderr).strip().splitlines()[0] if done.returncode == 0 else None


def doctor() -> int:
    checks: list[dict[str, object]] = []

    def record(name: str, ok: bool, detail: str, fix: str, required: bool = True) -> None:
        checks.append(
            {"name": name, "ok": ok, "required": required, "detail": detail, "fix": None if ok else fix}
        )

    record("git", shutil.which("git") is not None, shutil.which("git") or "absent", "install Git")
    node = version_of(["node", "--version"])
    node_ok = bool(node) and int(node.lstrip("v").split(".")[0]) >= 24
    record("node", node_ok, node or "absent", "install Node 24 or newer (package.json engines)")
    pnpm = version_of(["pnpm", "--version"])
    record("pnpm", pnpm is not None, pnpm or "absent", "corepack enable (packageManager pins pnpm 11)")
    record(
        "python",
        sys.version_info >= (3, 11),
        sys.version.split()[0],
        "Python 3.11 or newer runs ./dev and the trace",
    )
    modules = ROOT / "node_modules"
    record("node_modules", modules.is_dir(), str(modules), "pnpm install --frozen-lockfile")
    target = database_target()
    record(
        ".env.lab",
        target["env_lab_is_loopback"] is True,
        "present, loopback (values not printed)"
        if target["env_lab_is_loopback"]
        else ("present, NOT loopback" if target["env_file"] else "absent"),
        "copy .env.example to .env.lab and fill it from the lab's `supabase status -o env`; only "
        "servers and lab proofs need it, not ./dev check",
        required=False,
    )
    state = hook_state()
    record("commit-msg hook", state == "managed", f"{state} in {hooks_dir()}", "./dev hooks install", required=False)
    record(
        "uv",
        shutil.which("uv") is not None,
        shutil.which("uv") or "absent",
        "install uv; only `./dev db` needs it (psycopg)",
        required=False,
    )
    for name, path in SIBLINGS.items():
        record(
            f"sibling {name}",
            path.is_dir(),
            str(path),
            "only needed for schema navigation (its workspace/) and to resolve record ids (trace)",
            required=False,
        )
    failed = [c for c in checks if not c["ok"] and c["required"]]
    emit({"ok": not failed, "checks": checks})
    return 3 if failed else 0


# ---------------------------------------------------------------------------- check and test


def check() -> int:
    if not (ROOT / "node_modules").is_dir():
        return fail("node_modules is absent", "pnpm install --frozen-lockfile", 3)
    results: dict[str, str] = {}
    for name, command in CHECK_STEPS:
        results[name] = "passed" if run(command) == 0 else "failed"
    planes_code = run([sys.executable, "-X", "utf8", str(PLANES), "planes", "check"])
    results["planes"] = "passed" if planes_code == 0 else "failed"
    up = upstream()
    revision_range = f"{up}..HEAD" if up else "HEAD~1..HEAD"
    trace_code = run([sys.executable, "-X", "utf8", str(TRACE), "check", "--range", revision_range])
    results["provenance"] = "passed (warn-only)" if trace_code == 0 else "failed (block mode)"
    emit({"check": results})
    return 1 if any(value.startswith("failed") for value in results.values()) else 0


def test(layer: str) -> int:
    for command in TEST_LAYERS[layer]:
        if run(command) != 0:
            return 1
    return 0


def trace(args: list[str]) -> int:
    return run([sys.executable, "-X", "utf8", str(TRACE), *(args or ["--help"])])


def hooks(action: str) -> int:
    target = hooks_dir() / "commit-msg"
    state = hook_state()
    if action == "status":
        emit({"commit-msg": state, "path": str(target), "source": "scripts/dev/hooks/commit-msg"})
        return 0
    if state == "unmanaged":
        return fail(
            f"{target} exists and is not ours; it is preserved",
            "chain it by adding this line to that hook: "
            'sh "$(git rev-parse --show-toplevel)/scripts/dev/hooks/commit-msg" "$1" || exit $?',
            3,
        )
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        "#!/bin/sh\n"
        f"{HOOK_MARKER}\n"
        "# Dispatcher written by ./dev hooks install; the logic is the tracked file below.\n"
        "root=$(git rev-parse --show-toplevel) || exit 0\n"
        '[ -f "$root/scripts/dev/hooks/commit-msg" ] || exit 0\n'
        'exec sh "$root/scripts/dev/hooks/commit-msg" "$@"\n',
        encoding="utf-8",
        newline="\n",
    )
    os.chmod(target, 0o755)
    emit({"installed": str(target), "was": state, "mode": os.environ.get("SDLC_TRACE", "warn")})
    return 0


def planes(group: str, args: list[str]) -> int:
    """`planes` runs here (standard library); `db` needs psycopg, so it runs through
    `uv run --with psycopg[binary]` unless this interpreter has it. Credentials resolve inside
    planes.py, never here."""

    command = [sys.executable, "-X", "utf8", str(PLANES), group, *args]
    if group == "db":
        try:
            import psycopg  # noqa: F401
        except ImportError:
            if not shutil.which("uv"):
                return fail("`./dev db` needs psycopg", "install uv (it supplies psycopg per run)", 3)
            command = [
                "uv", "run", "--no-project", "--quiet", "--with", "psycopg[binary]",
                "python", "-X", "utf8", str(PLANES), group, *args,
            ]  # fmt: skip
    return subprocess.run(command, cwd=ROOT, check=False).returncode


# --------------------------------------------------------------------------------------- main


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
    parser = argparse.ArgumentParser(
        prog="./dev", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = parser.add_subparsers(dest="command", metavar="COMMAND")
    sub.add_parser("status", help="orient in one call (JSON)", description="Example: ./dev status")
    sub.add_parser("doctor", help="read-only readiness (JSON)", description="Example: ./dev doctor")
    sub.add_parser(
        "check",
        help="the fast gate: pnpm typecheck, pnpm test, pnpm lint, planes check, provenance",
        description="Runs, in order: "
        + "; ".join(" ".join(c) for _, c in CHECK_STEPS)
        + "; python scripts/dev/planes.py planes check"
        + "; python docs/tools/trace.py check --range <upstream>..HEAD (warn-only)",
    )
    p_test = sub.add_parser(
        "test",
        help="unit (pnpm test) or surface (pnpm build, then the consumer scorecard without a database)",
    )
    p_test.add_argument("layer", choices=sorted(TEST_LAYERS))
    sub.add_parser(
        "trace",
        help="the provenance chain: show ID | build | check | linear pull",
        description="Examples: ./dev trace show AS-S9   ./dev trace check   ./dev trace build",
        add_help=False,
    )
    p_hooks = sub.add_parser("hooks", help="install or inspect the warn-only commit-msg hook")
    p_hooks.add_argument("action", choices=("install", "status"))
    sub.add_parser("planes", help="the data-plane registry: list | show PLANE | check", add_help=False)
    sub.add_parser("db", help="read-only database sessions: status | schema | query --plane P", add_help=False)
    argv = sys.argv[1:]
    if argv and argv[0] == "trace":
        return trace(argv[1:])
    if argv and argv[0] in {"planes", "db"}:
        return planes(argv[0], argv[1:] or ["--help"])
    args = parser.parse_args(argv)
    if args.command is None:
        parser.print_help()
        return 2
    if args.command == "status":
        return status()
    if args.command == "doctor":
        return doctor()
    if args.command == "check":
        return check()
    if args.command == "hooks":
        return hooks(args.action)
    return test(args.layer)


if __name__ == "__main__":
    sys.exit(main())
