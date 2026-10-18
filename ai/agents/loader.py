from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path

from jsonschema.validators import Draft202012Validator
import yaml

from ai.models.loader import ModelProfile, load_model_profiles


DEFINITION_DIRECTORY = Path(__file__).resolve().parent / "definitions"


@dataclass(frozen=True)
class AgentConfiguration:
    id: str
    name: str
    name_environment_variable: str | None
    description: str
    model: ModelProfile
    instructions: str
    reasoning: dict
    response_name: str
    response_description: str
    response_schema: dict
    metadata: dict[str, str]
    source_path: Path
    schema_path: Path

    def resolved_name(self) -> str:
        if self.name_environment_variable:
            return os.environ.get(self.name_environment_variable, self.name)
        return self.name

    def configuration_hash(self, model_deployment: str) -> str:
        payload = {
            "agent": {
                "id": self.id,
                "name": self.resolved_name(),
                "description": self.description,
                "instructions": self.instructions,
                "reasoning": self.reasoning,
                "response_name": self.response_name,
                "response_description": self.response_description,
                "metadata": self.metadata,
            },
            "model_deployment": model_deployment,
            "response_schema": self.response_schema,
        }
        return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def load_agent_configurations(
    directory: Path = DEFINITION_DIRECTORY,
    model_profiles: dict[str, ModelProfile] | None = None,
) -> dict[str, AgentConfiguration]:
    models = model_profiles or load_model_profiles()
    configurations: dict[str, AgentConfiguration] = {}
    for path in sorted(directory.glob("*.yaml")):
        payload = yaml.safe_load(path.read_text())
        model_id = payload["model"]
        if model_id not in models:
            raise ValueError(f"{path.name} references unknown model profile: {model_id}")
        response = payload["response"]
        schema_path = (path.parent / response["schema"]).resolve()
        schema = json.loads(schema_path.read_text())
        Draft202012Validator.check_schema(schema)
        configuration = AgentConfiguration(
            id=payload["id"],
            name=payload["name"],
            name_environment_variable=payload.get("name_environment_variable"),
            description=payload["description"],
            model=models[model_id],
            instructions=payload["instructions"].strip(),
            reasoning=dict(payload.get("reasoning", {})),
            response_name=response["name"],
            response_description=response["description"],
            response_schema=schema,
            metadata={str(key): str(value) for key, value in payload.get("metadata", {}).items()},
            source_path=path,
            schema_path=schema_path,
        )
        if configuration.id in configurations:
            raise ValueError(f"Duplicate agent id: {configuration.id}")
        configurations[configuration.id] = configuration
    if not configurations:
        raise ValueError(f"No agent definitions found in {directory}")
    return configurations


def get_agent_configuration(agent_id: str) -> AgentConfiguration:
    try:
        return load_agent_configurations()[agent_id]
    except KeyError as exc:
        raise ValueError(f"Unknown agent definition: {agent_id}") from exc
