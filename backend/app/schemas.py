from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints, field_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class RegisterInput(StrictModel):
    display_name: str = Field(min_length=2, max_length=80)
    email: EmailStr
    password: Annotated[str, StringConstraints(strip_whitespace=False, min_length=12, max_length=128)]
    registration_token: str = Field(default="", max_length=256)


class LoginInput(StrictModel):
    email: EmailStr
    password: Annotated[str, StringConstraints(strip_whitespace=False, min_length=1, max_length=128)]


class ProjectInput(StrictModel):
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=2000)
    color: str = "#7357F6"

    @field_validator("color")
    @classmethod
    def validate_color(cls, value: str) -> str:
        if len(value) != 7 or value[0] != "#" or any(c not in "0123456789abcdefABCDEF" for c in value[1:]):
            raise ValueError("Color must be a hex color")
        return value.upper()


class DatasetInput(StrictModel):
    project_id: str
    name: str = Field(min_length=1, max_length=120)
    version: str = Field(default="v1", max_length=40)
    format: str = Field(default="other", max_length=40)
    uri: str = Field(default="", max_length=2000)
    size_bytes: int = Field(default=0, ge=0)
    row_count: int | None = Field(default=None, ge=0)
    description: str = Field(default="", max_length=2000)


class ModelInput(StrictModel):
    project_id: str
    name: str = Field(min_length=1, max_length=120)
    framework: str = Field(default="Other", max_length=60)
    task_type: str = Field(default="Other", max_length=80)
    status: Literal["development", "staging", "production", "archived"] = "development"
    repository_url: str = Field(default="", max_length=2000)
    description: str = Field(default="", max_length=2000)


class ModelVersionInput(StrictModel):
    version: str = Field(min_length=1, max_length=40)
    stage: Literal["candidate", "staging", "production", "archived"] = "candidate"
    artifact_uri: str = Field(default="", max_length=2000)
    parameters_count: int | None = Field(default=None, ge=0)
    notes: str = Field(default="", max_length=4000)


class ExperimentInput(StrictModel):
    project_id: str
    dataset_id: str | None = None
    model_id: str | None = None
    name: str = Field(min_length=1, max_length=140)
    status: Literal["draft", "running", "completed", "failed", "archived"] = "draft"
    objective: str = Field(default="", max_length=500)
    description: str = Field(default="", max_length=3000)


class ExperimentStatusInput(StrictModel):
    status: Literal["draft", "running", "completed", "failed", "archived"]


class RunInput(StrictModel):
    experiment_id: str
    model_version_id: str | None = None
    name: str = Field(min_length=1, max_length=140)
    run_type: Literal["training", "evaluation", "inference"] = "training"
    status: Literal["queued", "running", "completed", "failed", "cancelled"] = "running"
    hyperparameters: dict[str, Any] = Field(default_factory=dict)
    environment: dict[str, Any] = Field(default_factory=dict)
    notes: str = Field(default="", max_length=4000)


class RunStatusInput(StrictModel):
    status: Literal["queued", "running", "completed", "failed", "cancelled"]


class MetricInput(StrictModel):
    name: str = Field(min_length=1, max_length=80)
    value: float = Field(allow_inf_nan=False)
    step: int | None = Field(default=None, ge=0)
