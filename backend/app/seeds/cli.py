import argparse
import sys
from pathlib import Path

from pydantic import ValidationError
from sqlalchemy.exc import SQLAlchemyError

from app.db.session import SessionLocal
from app.seeds.catalog import load_bundled_catalog, load_catalog_file
from app.seeds.loader import SeedConflictError, SeedReport, seed_catalog
from app.seeds.schema import SeedCatalog


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Validate or load Recipe Lab demo data.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    for command in ("validate", "load"):
        subparser = subparsers.add_parser(command)
        subparser.add_argument(
            "--file",
            type=Path,
            help="Use one complete catalog JSON file instead of the bundled data.",
        )
    return parser


def _load_requested_catalog(path: Path | None) -> SeedCatalog:
    return load_catalog_file(path) if path is not None else load_bundled_catalog()


def _print_validation_summary(catalog: SeedCatalog) -> None:
    variant_count = sum(recipe.parent is not None for recipe in catalog.recipes)
    print(
        f"Validated {catalog.metadata.title} v{catalog.metadata.version}: "
        f"{len(catalog.recipes)} recipe versions, {variant_count} variants, "
        f"{len(catalog.ingredients)} ingredients, "
        f"{len(catalog.substitutions)} substitutions, "
        f"{len(catalog.measurement_catalog.units)} measurement units."
    )


def _print_load_summary(report: SeedReport) -> None:
    print(f"Seed load complete: {report.created_total} created, {report.reused_total} reused.")
    for entity in sorted(set(report.created) | set(report.reused)):
        print(f"  {entity}: {report.created[entity]} created, {report.reused[entity]} reused")


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    try:
        catalog = _load_requested_catalog(args.file)
        if args.command == "validate":
            _print_validation_summary(catalog)
            return 0

        with SessionLocal.begin() as session:
            report = seed_catalog(session, catalog)
        _print_load_summary(report)
        return 0
    except (OSError, ValueError, ValidationError, SeedConflictError, SQLAlchemyError) as error:
        print(f"Seed {args.command} failed: {error}", file=sys.stderr)
        return 1
