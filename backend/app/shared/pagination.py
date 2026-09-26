from typing import Annotated

from fastapi import Depends, Query


class Pagination:
    """Bounded offset/limit for list routes.

    A page request outside the range is rejected at the edge with 422 rather
    than reaching the database: ``skip`` must be >= 0 (a negative offset is a
    query error) and ``limit`` must be within 0..100 (an unbounded limit is a
    full-table scan). ``limit=0`` returns an empty page with the total count.
    """

    def __init__(
        self,
        skip: Annotated[int, Query(ge=0)] = 0,
        limit: Annotated[int, Query(ge=0, le=100)] = 100,
    ) -> None:
        self.skip = skip
        self.limit = limit


PaginationDep = Annotated[Pagination, Depends(Pagination)]
