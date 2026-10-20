from __future__ import annotations

import argparse

from ai.agents.loader import load_agent_configurations
from ai.agents.provision import provision_agents
from ai.evaluations.runner import load_evaluation, provision_evaluation
from ai.models.loader import load_model_profiles


def validate_configuration() -> tuple[dict, dict, tuple]:
    models = load_model_profiles()
    agents = load_agent_configurations(model_profiles=models)
    evaluation = load_evaluation()
    return models, agents, evaluation


def main():
    parser = argparse.ArgumentParser(description="Validate or apply the declarative FanPulse Foundry solution.")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Create new Foundry agent versions when the checked-in definitions changed.",
    )
    args = parser.parse_args()

    models, agents, (evaluation, cases, _) = validate_configuration()
    for profile in models.values():
        print(
            f"valid model profile: {profile.id} -> {profile.model_name} {profile.model_version} "
            f"as {profile.deployment_name()} ({profile.sku_name}, {profile.region})"
        )
    for configuration in agents.values():
        print(f"valid agent: {configuration.id} -> {configuration.resolved_name()}")
    print(f"valid evaluation: {evaluation['id']} -> {evaluation['name']} ({len(cases)} static cases)")

    if args.apply:
        for result in provision_agents():
            print(f"{result['status']}: {result['name']} version {result['version']}")
        result = provision_evaluation()
        print(f"{result['status']}: evaluation {result['name']} ({result['id']})")
    else:
        print("validation only; use --apply to publish changed agent and evaluation definitions")


if __name__ == "__main__":
    main()
