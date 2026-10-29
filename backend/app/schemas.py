from __future__ import annotations

import copy
import json
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints, create_model, field_validator

Password = Annotated[str, StringConstraints(strip_whitespace=False, min_length=12, max_length=128)]
Tags = Annotated[list[Annotated[str, StringConstraints(min_length=1, max_length=40)]], Field(max_length=20)]


def bounded_json(value: Any, *, max_bytes: int = 32768, max_depth: int = 8) -> Any:
    def depth(item: Any, level: int = 0) -> None:
        if level > max_depth:
            raise ValueError(f"JSON may be at most {max_depth} levels deep")
        if isinstance(item, dict):
            if any(not isinstance(key, str) or len(key) > 120 for key in item):
                raise ValueError("JSON keys must be strings of at most 120 characters")
            for child in item.values():
                depth(child, level + 1)
        elif isinstance(item, list):
            for child in item:
                depth(child, level + 1)
    depth(value)
    try:
        encoded = json.dumps(value, allow_nan=False, ensure_ascii=False).encode()
    except (ValueError, TypeError) as exc:
        raise ValueError("JSON must contain finite, serializable values") from exc
    if len(encoded) > max_bytes:
        raise ValueError(f"JSON exceeds {max_bytes} bytes")
    return value


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class RegisterInput(StrictModel):
    display_name: str = Field(min_length=2, max_length=80)
    email: EmailStr
    password: Password
    registration_token: str = Field(default="", max_length=256)


class LoginInput(StrictModel):
    email: EmailStr
    password: Annotated[str, StringConstraints(strip_whitespace=False, min_length=1, max_length=128)]


class RecoveryInput(StrictModel):
    email: EmailStr
    recovery_code: str = Field(min_length=1, max_length=256)
    password: Password


class RecoveryCodeInput(StrictModel):
    password: Annotated[str, StringConstraints(strip_whitespace=False, min_length=1, max_length=128)]


class ProfileInput(StrictModel):
    display_name: str = Field(min_length=2, max_length=80)


class PasswordInput(StrictModel):
    current_password: Annotated[str, StringConstraints(strip_whitespace=False, min_length=1, max_length=128)]
    password: Password


class TokenInput(RecoveryCodeInput):
    name: str = Field(min_length=1, max_length=80)
    scopes: list[Literal["read", "write", "metrics:write"]] = Field(min_length=1, max_length=3)
    expires_days: int = Field(default=90, ge=1, le=365)
    project_id: str | None = Field(default=None, max_length=80)

    @field_validator("scopes")
    @classmethod
    def distinct_scopes(cls, value: list[str]) -> list[str]:
        return sorted(set(value))


class TaggedInput(StrictModel):
    tags: Tags = Field(default_factory=list)

    @field_validator("tags")
    @classmethod
    def distinct_tags(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(tag.strip() for tag in value))


class ProjectInput(TaggedInput):
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=2000)
    color: str = "#7357F6"
    archived: bool = False

    @field_validator("color")
    @classmethod
    def validate_color(cls, value: str) -> str:
        if len(value) != 7 or value[0] != "#" or any(c not in "0123456789abcdefABCDEF" for c in value[1:]):
            raise ValueError("Color must be a hex color")
        return value.upper()


class DatasetInput(TaggedInput):
    project_id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=120)
    version: str = Field(default="v1", min_length=1, max_length=40)
    format: str = Field(default="other", max_length=40)
    uri: str = Field(default="", max_length=2000)
    size_bytes: int = Field(default=0, ge=0)
    row_count: int | None = Field(default=None, ge=0)
    description: str = Field(default="", max_length=2000)
    checksum: str = Field(default="", max_length=256)


class ModelInput(TaggedInput):
    project_id: str = Field(min_length=1, max_length=80)
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
    checksum: str = Field(default="", max_length=256)


class ExperimentInput(TaggedInput):
    project_id: str = Field(min_length=1, max_length=80)
    dataset_id: str | None = Field(default=None, max_length=80)
    model_id: str | None = Field(default=None, max_length=80)
    name: str = Field(min_length=1, max_length=140)
    status: Literal["draft", "running", "completed", "failed", "archived"] = "draft"
    objective: str = Field(default="", max_length=500)
    description: str = Field(default="", max_length=3000)
    primary_metric: str = Field(default="val_accuracy", min_length=1, max_length=80)
    metric_direction: Literal["max", "min"] = "max"
    metric_aggregation: Literal["best", "final"] = "best"
    metric_unit: str = Field(default="fraction", min_length=1, max_length=40)
    metric_split: str = Field(default="validation", max_length=40)
    metric_policy_confirmed: bool = True


class ExperimentStatusInput(StrictModel):
    status: Literal["draft", "running", "completed", "failed", "archived"]


class RunInput(TaggedInput):
    experiment_id: str = Field(min_length=1, max_length=80)
    model_version_id: str | None = Field(default=None, max_length=80)
    parent_run_id: str | None = Field(default=None, max_length=80)
    name: str = Field(min_length=1, max_length=140)
    run_type: Literal["training", "evaluation", "inference"] = "training"
    status: Literal["queued", "running", "completed", "failed", "cancelled"] = "running"
    hyperparameters: dict[str, Any] = Field(default_factory=dict)
    environment: dict[str, Any] = Field(default_factory=dict)
    provenance: dict[str, Any] = Field(default_factory=dict)
    notes: str = Field(default="", max_length=4000)

    @field_validator("hyperparameters", "environment", "provenance")
    @classmethod
    def validate_json(cls, value: dict[str, Any]) -> dict[str, Any]:
        return bounded_json(value)


class RunStatusInput(StrictModel):
    status: Literal["queued", "running", "completed", "failed", "cancelled"]


class MetricInput(StrictModel):
    name: str = Field(min_length=1, max_length=80)
    value: float = Field(allow_inf_nan=False)
    step: int | None = Field(default=None, ge=0)
    unit: str = Field(default="", max_length=40)
    split: str = Field(default="", max_length=40)


class MetricBatchInput(StrictModel):
    metrics: list[MetricInput] = Field(min_length=1, max_length=500)
    idempotency_key: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9_.:-]+$")


class ImportInput(StrictModel):
    data: dict[str, Any]
    dry_run: bool = True

    @field_validator("data")
    @classmethod
    def validate_data(cls, value: dict[str, Any]) -> dict[str, Any]:
        return bounded_json(value, max_bytes=4_000_000, max_depth=12)


def partial_model(name: str, source: type[BaseModel]) -> type[BaseModel]:
    # Omitted fields are ignored; explicit null still fails for non-null fields.
    fields = {}
    for key, original in source.model_fields.items():
        info = copy.copy(original)
        info.default = None
        info.default_factory = None
        fields[key] = (original.annotation, info)
    return create_model(name, __base__=source, **fields)


ProjectPatch = partial_model("ProjectPatch", ProjectInput)
DatasetPatch = partial_model("DatasetPatch", DatasetInput)
ModelPatch = partial_model("ModelPatch", ModelInput)
ModelVersionPatch = partial_model("ModelVersionPatch", ModelVersionInput)
ExperimentPatch = partial_model("ExperimentPatch", ExperimentInput)
RunPatch = partial_model("RunPatch", RunInput)
