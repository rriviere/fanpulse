from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path

import yaml


MODEL_DIRECTORY = Path(__file__).resolve().parent / "deployments"


@dataclass(frozen=True)
class ModelProfile:
    id: str
    provider: str
    purpose: str
    deployment_default_name: str
    deployment_environment_variable: str
    model_name: str
    model_version: str
    model_format: str
    sku_name: str
    capacity: int
    region: str
    capabilities: tuple[str, ...]
    authentication: str
    defaults: dict
    source_path: Path

    def deployment_name(self) -> str:
        return os.environ.get(self.deployment_environment_variable, self.deployment_default_name)


def load_model_profiles(directory: Path = MODEL_DIRECTORY) -> dict[str, ModelProfile]:
    profiles: dict[str, ModelProfile] = {}
    for path in sorted(directory.glob("*.yaml")):
        payload = yaml.safe_load(path.read_text())
        deployment = payload.get("deployment", {})
        model = deployment.get("model", {})
        sku = deployment.get("sku", {})
        profile = ModelProfile(
            id=payload["id"],
            provider=payload["provider"],
            purpose=payload["purpose"],
            deployment_default_name=deployment["name"],
            deployment_environment_variable=deployment["environment_variable"],
            model_name=model["name"],
            model_version=str(model["version"]),
            model_format=model["format"],
            sku_name=sku["name"],
            capacity=int(sku["capacity"]),
            region=deployment["region"],
            capabilities=tuple(payload.get("capabilities", [])),
            authentication=payload["authentication"],
            defaults=dict(payload.get("defaults", {})),
            source_path=path,
        )
        if profile.id in profiles:
            raise ValueError(f"Duplicate model profile id: {profile.id}")
        profiles[profile.id] = profile
    if not profiles:
        raise ValueError(f"No model profiles found in {directory}")
    return profiles


def get_model_profile(profile_id: str) -> ModelProfile:
    try:
        return load_model_profiles()[profile_id]
    except KeyError as exc:
        raise ValueError(f"Unknown model profile: {profile_id}") from exc
