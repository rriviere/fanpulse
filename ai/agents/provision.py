from __future__ import annotations

import os

from azure.ai.projects import AIProjectClient
from azure.ai.projects.models import PromptAgentDefinition, PromptAgentDefinitionTextOptions, TextResponseFormatJsonSchema
from azure.identity import DefaultAzureCredential

from .loader import AgentConfiguration, load_agent_configurations


def build_definition(configuration: AgentConfiguration, model_deployment: str) -> PromptAgentDefinition:
    return PromptAgentDefinition(
        model=model_deployment,
        instructions=configuration.instructions,
        reasoning=configuration.reasoning,
        text=PromptAgentDefinitionTextOptions(
            format=TextResponseFormatJsonSchema(
                name=configuration.response_name,
                description=configuration.response_description,
                schema=configuration.response_schema,
                strict=True,
            )
        ),
    )


def _ensure_agent(project, configuration: AgentConfiguration) -> dict[str, str]:
    model_deployment = configuration.model.deployment_name()
    agent_name = configuration.resolved_name()
    config_hash = configuration.configuration_hash(model_deployment)
    versions = list(project.agents.list_versions(agent_name=agent_name))
    if versions:
        latest = max(versions, key=lambda item: int(item.version))
        if (latest.metadata or {}).get("configuration_sha256") == config_hash:
            return {"id": configuration.id, "name": agent_name, "version": str(latest.version), "status": "unchanged"}

    metadata = {
        **configuration.metadata,
        "configuration_sha256": config_hash,
        "definition_file": configuration.source_path.name,
        "schema_file": configuration.schema_path.name,
    }
    created = project.agents.create_version(
        agent_name=agent_name,
        definition=build_definition(configuration, model_deployment),
        description=configuration.description,
        metadata=metadata,
    )
    return {"id": configuration.id, "name": created.name, "version": str(created.version), "status": "created"}


def provision_agents() -> list[dict[str, str]]:
    endpoint = os.environ["FOUNDRY_PROJECT_ENDPOINT"]
    configurations = load_agent_configurations()
    with DefaultAzureCredential() as credential, AIProjectClient(endpoint=endpoint, credential=credential) as project:
        return [_ensure_agent(project, configuration) for configuration in configurations.values()]


def main():
    for result in provision_agents():
        print(f"{result['status']}: {result['name']} version {result['version']}")


if __name__ == "__main__":
    main()
