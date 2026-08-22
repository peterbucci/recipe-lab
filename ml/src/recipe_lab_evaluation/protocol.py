from __future__ import annotations

import hashlib
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol, runtime_checkable
from uuid import UUID

from .dataset import SnapshotEvent, SnapshotRecipe

type JsonScalar = str | int | float | bool | None


@dataclass(frozen=True, slots=True)
class ModelMetadata:
    model_id: str
    version: str
    parameters: Mapping[str, JsonScalar] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.model_id.strip():
            raise ValueError("model_id must not be blank")
        if not self.version.strip():
            raise ValueError("model version must not be blank")


@dataclass(frozen=True, slots=True)
class ModelTrainingData:
    cutoff: datetime
    recipes: tuple[SnapshotRecipe, ...]
    events: tuple[SnapshotEvent, ...]


class FittedEvaluationModel(Protocol):
    @property
    def metadata(self) -> ModelMetadata: ...

    def rank(
        self,
        *,
        user_id: UUID,
        candidate_ids: tuple[UUID, ...],
        limit: int,
    ) -> Sequence[UUID]: ...


@runtime_checkable
class FittedCollaborativeArtifactProvider(Protocol):
    """Report-v3 contract for collaborative-v1 aggregate artifact metadata.

    The runner validates the complete field allowlist and scalar types before
    publishing it. The collaborative-specific property name prevents unrelated
    future models from being mistaken for this schema. A future artifact shape
    requires an explicit report schema revision.
    """

    @property
    def collaborative_artifact_document(self) -> Mapping[str, JsonScalar]: ...


class EvaluationModel(Protocol):
    @property
    def metadata(self) -> ModelMetadata: ...

    def fit(self, training: ModelTrainingData, *, seed: int) -> FittedEvaluationModel: ...


def derive_model_seed(root_seed: int, model_id: str) -> int:
    """Derive a stable, isolated unsigned 64-bit seed for one model."""

    material = f"{root_seed}\0{model_id}".encode()
    return int.from_bytes(hashlib.sha256(material).digest()[:8], byteorder="big")
