"""Shared Pydantic schema helpers.

The backend uses Pydantic v2. Keep schemas consistent and avoid repeating
`from_attributes=True` boilerplate across ORM-backed response models.
"""

from pydantic import BaseModel, ConfigDict


class ORMBaseModel(BaseModel):
    """Base model for schemas built from ORM objects."""

    model_config = ConfigDict(from_attributes=True)

