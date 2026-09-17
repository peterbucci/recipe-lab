"""Private initialization/verification command; never erases product records."""

import argparse
import sys
from datetime import UTC, datetime

from app.core.config import settings
from app.db.session import SessionLocal
from app.services.sandbox import initialize_generation_workflow, verify_active_generation


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("initialize", "verify"))
    parser.add_argument("--expected-database-name", required=True)
    arguments = parser.parse_args(argv)
    try:
        with SessionLocal() as session:
            if arguments.command == "initialize":
                initialize_generation_workflow(
                    session,
                    settings=settings,
                    expected_database_name=arguments.expected_database_name,
                    now=datetime.now(UTC),
                )
            else:
                from app.repositories.sandbox import database_name

                if database_name(session) != arguments.expected_database_name:
                    raise ValueError("Database mismatch.")
                verify_active_generation(session, settings=settings, now=datetime.now(UTC))
    except Exception:  # noqa: BLE001
        print("Sandbox generation operation failed.", file=sys.stderr)
        return 1
    print("Sandbox generation verified.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
