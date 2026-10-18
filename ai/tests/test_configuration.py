from jsonschema import validate

from ai.agents.loader import load_agent_configurations
from ai.models.loader import load_model_profiles


def test_declarative_foundry_configuration_loads():
    models = load_model_profiles()
    agents = load_agent_configurations(model_profiles=models)

    assert set(models) == {"foundry-multimodal"}
    profile = models["foundry-multimodal"]
    assert profile.deployment_default_name == "gpt-5-mini"
    assert profile.model_name == "gpt-5-mini"
    assert profile.model_version == "2025-08-07"
    assert profile.sku_name == "GlobalStandard"
    assert profile.region == "australiaeast"
    assert set(agents) == {"fan-engagement", "match-analyst"}
    assert all(agent.instructions for agent in agents.values())
    assert all(agent.model.id == "foundry-multimodal" for agent in agents.values())


def test_agent_response_schemas_accept_representative_outputs():
    agents = load_agent_configurations()
    validate(
        {
            "significant": False,
            "significance": 25,
            "summary": "Routine midfield possession.",
            "rationale": "No decisive action is visible.",
            "uncertainty_note": None,
        },
        agents["match-analyst"].response_schema,
    )
    validate(
        {
            "publish_insight": True,
            "significance": 80,
            "headline": "Green breaks into space",
            "explanation": "A visible carry creates an attacking opportunity.",
            "uncertainty_note": None,
            "poll": {
                "question": "What should happen next?",
                "options": [{"id": "shoot", "label": "Shoot"}, {"id": "pass", "label": "Pass"}],
                "duplicate_key": "green-attacking-carry",
            },
        },
        agents["fan-engagement"].response_schema,
    )
