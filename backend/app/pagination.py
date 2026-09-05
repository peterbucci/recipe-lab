"""Internal pagination values shared without changing public response schemas."""

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class PageParams:
    page: int
    page_size: int

    def __post_init__(self) -> None:
        if self.page < 1:
            raise ValueError("page must be at least 1")
        if self.page_size < 1:
            raise ValueError("page_size must be at least 1")

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size

    def total_pages(self, total: int) -> int:
        if total < 0:
            raise ValueError("total must not be negative")
        return (total + self.page_size - 1) // self.page_size


@dataclass(frozen=True, slots=True)
class PageSlice[T]:
    """Repository result for one bounded page and the full matching count."""

    items: list[T]
    total: int

    def __post_init__(self) -> None:
        if self.total < 0:
            raise ValueError("total must not be negative")
