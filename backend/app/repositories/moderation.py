from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.models import (
    CommunityModerator,
    RecipeModerationAuditEvent,
    RecipeModerationCase,
    RecipeReport,
    RecipeVersion,
    RecipeVersionPublication,
    User,
)
from app.policies.recipe_visibility import publicly_readable_recipe_publication_filter


@dataclass(frozen=True, slots=True)
class ModerationCaseQueueItem:
    moderation_case: RecipeModerationCase
    publication: RecipeVersionPublication
    recipe: RecipeVersion
    author: User
    reporter_count: int
    last_reported_at: datetime


@dataclass(frozen=True, slots=True)
class ModerationCaseBrowseResult:
    items: list[ModerationCaseQueueItem]
    total: int


@dataclass(frozen=True, slots=True)
class ModerationAuditRecord:
    event: RecipeModerationAuditEvent
    actor: User


def is_community_moderator(
    session: Session,
    user_id: UUID,
    *,
    for_update: bool = False,
) -> bool:
    statement = select(CommunityModerator.user_id).where(CommunityModerator.user_id == user_id)
    if for_update:
        statement = statement.with_for_update()
    return session.scalar(statement) is not None


def get_recipe_report_by_action(
    session: Session,
    *,
    reporter_user_id: UUID,
    action_id: UUID,
) -> RecipeReport | None:
    return session.scalar(
        select(RecipeReport).where(
            RecipeReport.reporter_user_id == reporter_user_id,
            RecipeReport.action_id == action_id,
        )
    )


def get_recipe_report_by_member_and_version(
    session: Session,
    *,
    reporter_user_id: UUID,
    recipe_version_id: UUID,
) -> RecipeReport | None:
    return session.scalar(
        select(RecipeReport).where(
            RecipeReport.reporter_user_id == reporter_user_id,
            RecipeReport.recipe_version_id == recipe_version_id,
        )
    )


def get_public_recipe_publication_for_update(
    session: Session,
    recipe_version_id: UUID,
) -> RecipeVersionPublication | None:
    return session.scalar(
        select(RecipeVersionPublication)
        .where(
            RecipeVersionPublication.recipe_version_id == recipe_version_id,
            publicly_readable_recipe_publication_filter(),
        )
        .with_for_update()
    )


def get_moderation_case(
    session: Session,
    recipe_version_id: UUID,
    *,
    for_update: bool = False,
) -> RecipeModerationCase | None:
    statement = select(RecipeModerationCase).where(
        RecipeModerationCase.recipe_version_id == recipe_version_id
    )
    if for_update:
        statement = statement.with_for_update()
    return session.scalar(statement)


def get_moderation_case_publication_for_update(
    session: Session,
    recipe_version_id: UUID,
) -> tuple[RecipeModerationCase, RecipeVersionPublication] | None:
    row = session.execute(
        select(RecipeModerationCase, RecipeVersionPublication)
        .join(
            RecipeVersionPublication,
            RecipeVersionPublication.recipe_version_id == RecipeModerationCase.recipe_version_id,
        )
        .where(RecipeModerationCase.recipe_version_id == recipe_version_id)
        .with_for_update(of=(RecipeModerationCase, RecipeVersionPublication))
    ).one_or_none()
    return (row[0], row[1]) if row is not None else None


def get_moderation_action_by_action(
    session: Session,
    *,
    actor_user_id: UUID,
    action_id: UUID,
) -> RecipeModerationAuditEvent | None:
    return session.scalar(
        select(RecipeModerationAuditEvent).where(
            RecipeModerationAuditEvent.actor_user_id == actor_user_id,
            RecipeModerationAuditEvent.action_id == action_id,
        )
    )


def browse_moderation_cases(
    session: Session,
    *,
    status: str | None,
    offset: int,
    limit: int,
) -> ModerationCaseBrowseResult:
    filters = []
    if status is not None:
        filters.append(RecipeModerationCase.status == status)
    total = (
        session.scalar(select(func.count()).select_from(RecipeModerationCase).where(*filters)) or 0
    )
    statement = (
        select(
            RecipeModerationCase,
            RecipeVersionPublication,
            RecipeVersion,
            User,
        )
        .join(
            RecipeVersionPublication,
            RecipeVersionPublication.recipe_version_id == RecipeModerationCase.recipe_version_id,
        )
        .join(
            RecipeVersion,
            RecipeVersion.id == RecipeModerationCase.recipe_version_id,
        )
        .join(User, User.id == RecipeVersion.created_by_user_id)
        .where(*filters)
        .order_by(
            case((RecipeModerationCase.status == "open", 0), else_=1),
            RecipeModerationCase.last_reported_at.desc(),
            RecipeModerationCase.recipe_version_id,
        )
        .offset(offset)
        .limit(limit)
    )
    return ModerationCaseBrowseResult(
        items=[
            ModerationCaseQueueItem(
                moderation_case=row[0],
                publication=row[1],
                recipe=row[2],
                author=row[3],
                reporter_count=row[0].reporter_count,
                last_reported_at=row[0].last_reported_at,
            )
            for row in session.execute(statement)
        ],
        total=total,
    )


def get_moderation_case_summary(
    session: Session,
    recipe_version_id: UUID,
) -> ModerationCaseQueueItem | None:
    row = session.execute(
        select(
            RecipeModerationCase,
            RecipeVersionPublication,
            RecipeVersion,
            User,
        )
        .join(
            RecipeVersionPublication,
            RecipeVersionPublication.recipe_version_id == RecipeModerationCase.recipe_version_id,
        )
        .join(
            RecipeVersion,
            RecipeVersion.id == RecipeModerationCase.recipe_version_id,
        )
        .join(User, User.id == RecipeVersion.created_by_user_id)
        .where(RecipeModerationCase.recipe_version_id == recipe_version_id)
    ).one_or_none()
    if row is None:
        return None
    return ModerationCaseQueueItem(
        moderation_case=row[0],
        publication=row[1],
        recipe=row[2],
        author=row[3],
        reporter_count=row[0].reporter_count,
        last_reported_at=row[0].last_reported_at,
    )


def list_case_reason_counts(
    session: Session,
    recipe_version_id: UUID,
) -> list[tuple[str, int]]:
    return [
        (row[0], int(row[1]))
        for row in session.execute(
            select(RecipeReport.reason, func.count(RecipeReport.id).label("count"))
            .where(RecipeReport.recipe_version_id == recipe_version_id)
            .group_by(RecipeReport.reason)
            .order_by(RecipeReport.reason)
        )
    ]


def list_case_reports(
    session: Session,
    recipe_version_id: UUID,
    *,
    limit: int,
) -> tuple[list[RecipeReport], int]:
    total = (
        session.scalar(
            select(func.count(RecipeReport.id)).where(
                RecipeReport.recipe_version_id == recipe_version_id
            )
        )
        or 0
    )
    reports = list(
        session.scalars(
            select(RecipeReport)
            .where(RecipeReport.recipe_version_id == recipe_version_id)
            .order_by(RecipeReport.created_at.desc(), RecipeReport.id)
            .limit(limit)
        )
    )
    return reports, total


def list_case_audit_history(
    session: Session,
    recipe_version_id: UUID,
    *,
    limit: int,
) -> tuple[list[ModerationAuditRecord], int]:
    total = (
        session.scalar(
            select(func.count(RecipeModerationAuditEvent.id)).where(
                RecipeModerationAuditEvent.recipe_version_id == recipe_version_id
            )
        )
        or 0
    )
    records = [
        ModerationAuditRecord(event=row[0], actor=row[1])
        for row in session.execute(
            select(RecipeModerationAuditEvent, User)
            .join(User, User.id == RecipeModerationAuditEvent.actor_user_id)
            .where(RecipeModerationAuditEvent.recipe_version_id == recipe_version_id)
            .order_by(
                RecipeModerationAuditEvent.occurred_at.desc(),
                RecipeModerationAuditEvent.id.desc(),
            )
            .limit(limit)
        )
    ]
    return records, total
