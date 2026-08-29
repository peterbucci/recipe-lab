from collections.abc import Iterable, Mapping

from sqlalchemy import (
    Column,
    ForeignKey,
    ForeignKeyConstraint,
    MetaData,
    String,
    Table,
    Uuid,
)

import app.models  # noqa: F401
from app.db.base import Base
from app.privacy.account_data_manifest import (
    DATABASE_TABLE_POLICIES,
    MANIFEST_REVIEW_REFERENCE,
    MANIFEST_SCHEMA_VERSION,
    NON_DATABASE_ARTIFACT_POLICIES,
    ArtifactKind,
    DatabaseTablePolicy,
    DataDisposition,
)


def _discover_account_linked_tables(metadata: MetaData) -> frozenset[str]:
    """Follow every reverse foreign-key edge reachable from the users table."""

    reverse_edges: dict[str, set[str]] = {str(name): set() for name in metadata.tables}
    for table in metadata.tables.values():
        for foreign_key in table.foreign_keys:
            reverse_edges[str(foreign_key.column.table.name)].add(str(table.name))

    linked = {"users"}
    while True:
        expanded = linked | {
            child for parent in linked for child in reverse_edges.get(parent, set())
        }
        if expanded == linked:
            return frozenset(linked)
        linked = expanded


def _foreign_key_locators(table: Table) -> frozenset[str]:
    locators: set[str] = set()
    for constraint in table.foreign_key_constraints:
        elements = list(constraint.elements)
        remote_tables = {str(element.column.table.name) for element in elements}
        assert len(remote_tables) == 1
        remote_table = next(iter(remote_tables))
        local_columns = ",".join(str(element.parent.name) for element in elements)
        remote_columns = ",".join(str(element.column.name) for element in elements)
        locators.add(f"{table.name}({local_columns})->{remote_table}({remote_columns})")
    return frozenset(locators)


def _relationship_locators() -> dict[str, frozenset[str]]:
    locators: dict[str, frozenset[str]] = {}
    for mapper in Base.registry.mappers:
        local_table = mapper.local_table
        assert isinstance(local_table, Table)
        table_name = str(local_table.name)
        relationships: set[str] = set()
        for relationship in mapper.relationships:
            target_table = relationship.mapper.local_table
            assert isinstance(target_table, Table)
            relationships.add(f"{table_name}.{relationship.key}->{target_table.name}")
        locators[table_name] = frozenset(relationships)
    return locators


def _manifest_findings(
    metadata: MetaData,
    relationships_by_table: Mapping[str, frozenset[str]],
    policies: Iterable[DatabaseTablePolicy] = DATABASE_TABLE_POLICIES,
) -> list[str]:
    findings: list[str] = []
    policy_by_table: dict[str, DatabaseTablePolicy] = {}
    for policy in policies:
        if policy.table in policy_by_table:
            findings.append(f"duplicate table policy: {policy.table}")
        policy_by_table[policy.table] = policy

        if not policy.columns:
            findings.append(f"table has no reviewed columns: {policy.table}")
        if len(policy.columns) != len(set(policy.columns)):
            findings.append(f"duplicate reviewed column: {policy.table}")
        if len(policy.foreign_keys) != len(set(policy.foreign_keys)):
            findings.append(f"duplicate reviewed foreign key: {policy.table}")
        if len(policy.relationships) != len(set(policy.relationships)):
            findings.append(f"duplicate reviewed relationship: {policy.table}")
        classified_columns = [
            column for column_policy in policy.column_policies for column in column_policy.columns
        ]
        if len(classified_columns) != len(set(classified_columns)):
            findings.append(f"overlapping field classifications: {policy.table}")
        if set(classified_columns) != set(policy.columns):
            findings.append(
                f"unclassified field disposition for {policy.table}: "
                f"declared={sorted(policy.columns)!r}, "
                f"classified={sorted(classified_columns)!r}"
            )
        for column_policy in policy.column_policies:
            if not column_policy.columns or not column_policy.rationale.strip():
                findings.append(f"invalid field classification: {policy.table}")
        if len({row_policy.case for row_policy in policy.row_policies}) != len(policy.row_policies):
            findings.append(f"duplicate row-policy case: {policy.table}")
        for row_policy in policy.row_policies:
            if not all(
                value.strip()
                for value in (
                    row_policy.case,
                    row_policy.selector,
                    row_policy.timing,
                    row_policy.rationale,
                )
            ):
                findings.append(f"invalid row policy: {policy.table}")
        if not set(policy.embedded_content_columns).issubset(policy.columns):
            findings.append(f"unknown embedded-content column: {policy.table}")
        if not policy.scope.strip() or not policy.rationale.strip():
            findings.append(f"table policy lacks review context: {policy.table}")

    linked_tables = _discover_account_linked_tables(metadata)
    declared_tables = frozenset(policy_by_table)
    for table_name in sorted(linked_tables - declared_tables):
        findings.append(f"unclassified account-linked table: {table_name}")
    for table_name in sorted(declared_tables - linked_tables):
        findings.append(f"declared table is not account-linked: {table_name}")

    for table_name in sorted(linked_tables & declared_tables):
        table = metadata.tables[table_name]
        policy = policy_by_table[table_name]
        actual_columns = tuple(str(column.name) for column in table.columns)
        if policy.columns != actual_columns:
            findings.append(
                f"unclassified column drift for {table_name}: "
                f"declared={policy.columns!r}, actual={actual_columns!r}"
            )

        actual_foreign_keys = _foreign_key_locators(table)
        if frozenset(policy.foreign_keys) != actual_foreign_keys:
            findings.append(
                f"unclassified foreign-key drift for {table_name}: "
                f"declared={sorted(policy.foreign_keys)!r}, "
                f"actual={sorted(actual_foreign_keys)!r}"
            )

        actual_relationships = relationships_by_table.get(table_name, frozenset())
        if frozenset(policy.relationships) != actual_relationships:
            findings.append(
                f"unclassified relationship drift for {table_name}: "
                f"declared={sorted(policy.relationships)!r}, "
                f"actual={sorted(actual_relationships)!r}"
            )

    return findings


def _cloned_metadata() -> MetaData:
    metadata = MetaData(naming_convention=Base.metadata.naming_convention)
    for table in Base.metadata.sorted_tables:
        table.to_metadata(metadata)
    return metadata


def test_reviewed_database_manifest_matches_every_account_linked_mapper() -> None:
    assert MANIFEST_SCHEMA_VERSION == "1"
    assert MANIFEST_REVIEW_REFERENCE == "RCP-33E / GitHub issue #93"
    assert _manifest_findings(Base.metadata, _relationship_locators()) == []


def test_manifest_guard_rejects_a_new_table_linked_to_an_account() -> None:
    metadata = _cloned_metadata()
    Table(
        "unclassified_member_notes",
        metadata,
        Column("id", Uuid(as_uuid=True), primary_key=True),
        Column("user_id", Uuid(as_uuid=True), ForeignKey("users.id"), nullable=False),
    )

    findings = _manifest_findings(metadata, _relationship_locators())

    assert "unclassified account-linked table: unclassified_member_notes" in findings


def test_manifest_guard_rejects_a_new_column_on_a_linked_table() -> None:
    metadata = _cloned_metadata()
    metadata.tables["users"].append_column(Column("private_tracking_id", String(64)))

    findings = _manifest_findings(metadata, _relationship_locators())

    assert any(finding.startswith("unclassified column drift for users:") for finding in findings)


def test_manifest_guard_rejects_a_new_foreign_key_path() -> None:
    metadata = _cloned_metadata()
    metadata.tables["users"].append_constraint(ForeignKeyConstraint(["id"], ["recipe_versions.id"]))

    findings = _manifest_findings(metadata, _relationship_locators())

    assert any(
        finding.startswith("unclassified foreign-key drift for users:") for finding in findings
    )


def test_manifest_guard_rejects_a_new_account_relationship() -> None:
    relationships = _relationship_locators()
    relationships["users"] = frozenset(
        {*relationships["users"], "users.private_versions->recipe_versions"}
    )

    findings = _manifest_findings(Base.metadata, relationships)

    assert any(
        finding.startswith("unclassified relationship drift for users:") for finding in findings
    )


def test_non_database_manifest_classifies_every_required_artifact_surface() -> None:
    assert set(DataDisposition) == {
        DataDisposition.DELETE,
        DataDisposition.ANONYMIZE,
        DataDisposition.RETAIN,
        DataDisposition.PROHIBIT,
    }
    assert len({policy.key for policy in NON_DATABASE_ARTIFACT_POLICIES}) == len(
        NON_DATABASE_ARTIFACT_POLICIES
    )
    assert {policy.key for policy in NON_DATABASE_ARTIFACT_POLICIES} == {
        "acceptance_and_test_artifacts",
        "aggregate_evaluation_outputs",
        "allowlisted_structured_operational_events",
        "browser_auth_cookies",
        "database_replica_wal_and_dead_rows",
        "deidentified_aggregate_service_metrics",
        "durable_account_deletion_evidence",
        "encrypted_database_backups",
        "external_oidc_provider_account",
        "fitted_recommender_process_state",
        "observed_recommender_snapshots",
        "operator_cli_and_support_exports",
        "raw_operational_access_logs_and_traces",
        "source_and_release_packages",
        "user_uploaded_files_and_derivatives",
    }
    assert {policy.kind for policy in NON_DATABASE_ARTIFACT_POLICIES} == set(ArtifactKind)

    for policy in NON_DATABASE_ARTIFACT_POLICIES:
        assert policy.locations
        assert all(location.strip() for location in policy.locations)
        assert policy.account_data.strip()
        assert policy.timing.strip()
        assert policy.required_control.strip()
        assert policy.rationale.strip()


def test_observability_artifacts_enforce_bounded_privacy_safe_sink_contracts() -> None:
    policies = {policy.key: policy for policy in NON_DATABASE_ARTIFACT_POLICIES}
    raw = policies["raw_operational_access_logs_and_traces"]
    events = policies["allowlisted_structured_operational_events"]
    aggregates = policies["deidentified_aggregate_service_metrics"]

    assert raw.disposition is DataDisposition.PROHIBIT
    assert events.disposition is DataDisposition.RETAIN
    assert aggregates.disposition is DataDisposition.RETAIN
    assert "7 days" in events.timing
    assert "30 days" in aggregates.timing

    event_controls = events.required_control.casefold()
    aggregate_controls = aggregates.required_control.casefold()
    for prohibited_value in (
        "raw paths",
        "query strings",
        "bodies",
        "ip addresses",
        "account-derived ids",
        "handles",
        "email",
        "private text",
        "caller-supplied",
    ):
        assert prohibited_value in event_controls
        assert prohibited_value in aggregate_controls
    assert "correlation ids" in aggregate_controls
    assert "application-issued random uuidv4" in event_controls
    for event_name in (
        "authentication_failure",
        "publication_failure",
        "database_failure",
        "application_failure",
        "recipe_lab.frontend.authentication_failed",
        "recipe_lab.frontend.recipe_api_unavailable",
    ):
        assert event_name in events.account_data
    assert "only event and correlation_id" in events.account_data
    assert "only event, correlation_id, and status_code" in events.account_data


def test_deletion_recovery_evidence_is_private_bounded_and_independently_verified() -> None:
    policies = {policy.key: policy for policy in NON_DATABASE_ARTIFACT_POLICIES}
    ledger = policies["durable_account_deletion_evidence"]

    assert ledger.kind is ArtifactKind.BACKUP
    assert ledger.disposition is DataDisposition.RETAIN
    assert "30-day" in ledger.timing
    assert "transient sha-256" in ledger.account_data.casefold()
    assert "not embedded" in ledger.account_data.casefold()
    controls = ledger.required_control.casefold()
    for required_control in (
        "encrypted",
        "separate from database backups",
        "independently supplied hash",
        "coverage cutoff",
        "never upload",
        "destroy temporary replay copies",
        "fail closed",
        "rather than truncating",
    ):
        assert required_control in controls
    assert "never silently window" in ledger.timing.casefold()
