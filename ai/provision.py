from __future__ import annotations

import argparse

from ai.agents.loader import load_agent_configurations
from ai.agents.provision import provision_agents
from ai.models.loader import load_model_profiles


def validate_configuration() -> tuple[dict, dict]:
    models = load_model_profiles()
    agents = load_agent_configurations(model_profiles=models)
    return models, agents


def main():
    parser = argparse.ArgumentParser(description="Validate or apply the declarative FanPulse Foundry solution.")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Create new Foundry agent versions when the checked-in definitions changed.",
    )
    args = parser.parse_args()

    models, agents = validate_configuration()
    for profile in models.values():
        print(
            f"valid model profile: {profile.id} -> {profile.model_name} {profile.model_version} "
            f"as {profile.deployment_name()} ({profile.sku_name}, {profile.region})"
        )
    for configuration in agents.values():
        print(f"valid agent: {configuration.id} -> {configuration.resolved_name()}")

    if args.apply:
        for result in provision_agents():
            print(f"{result['status']}: {result['name']} version {result['version']}")
    else:
        print("validation only; use --apply to publish changed agent definitions")


if __name__ == "__main__":
    main()
