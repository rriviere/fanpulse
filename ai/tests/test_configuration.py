import pytest
from jsonschema import validate
from pydantic import ValidationError

from ai.agents.contracts import AgentPoll, AgentPollOption, FanEngagementDecision
from ai.agents.loader import load_agent_configurations
from ai.evaluations.loader import load_evaluation
from ai.evaluations.provision import ITEM_SCHEMA, build_testing_criteria
from ai.evaluations.run import write_pipeline_results
from ai.models.loader import load_model_profiles


FOUNDRY_UNSUPPORTED_SCHEMA_KEYWORDS = {"allOf", "if", "then", "not"}


def _schema_keywords(value):
    if isinstance(value, dict):
        for key, child in value.items():
            yield key
            yield from _schema_keywords(child)
    elif isinstance(value, list):
        for child in value:
            yield from _schema_keywords(child)


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


def test_agent_response_schemas_use_foundry_supported_subset():
    for agent in load_agent_configurations().values():
        unsupported = FOUNDRY_UNSUPPORTED_SCHEMA_KEYWORDS.intersection(_schema_keywords(agent.response_schema))
        assert not unsupported, f"{agent.id} uses unsupported Foundry schema keywords: {sorted(unsupported)}"


def test_fan_engagement_poll_threshold_matches_declared_sixty():
    poll = AgentPoll(
        question="What happens next?",
        options=[
            AgentPollOption(id="attack", label="Attack continues"),
            AgentPollOption(id="recover", label="Defence recovers"),
        ],
        duplicate_key="green-attacking-sequence",
    )
    accepted = FanEngagementDecision(
        publish_insight=True,
        significance=60,
        headline="Green advance",
        explanation="A visible attacking sequence is developing.",
        poll=poll,
    )
    assert accepted.poll == poll

    with pytest.raises(ValidationError, match="significance >= 60"):
        FanEngagementDecision(
            publish_insight=True,
            significance=59,
            headline="Green advance",
            explanation="A visible attacking sequence is developing.",
            poll=poll,
        )


def test_evaluation_configuration_has_balanced_six_case_dataset():
    configuration, cases = load_evaluation()

    assert configuration.model.id == "foundry-multimodal"
    assert len(cases) == 6
    assert {category: sum(case.category == category for case in cases) for category in {"routine", "significant", "ambiguous"}} == {
        "routine": 2,
        "significant": 2,
        "ambiguous": 2,
    }
    assert sum(case.expected_poll for case in cases) == 2


def test_evaluation_definition_uses_grounding_and_poll_criteria():
    configuration, _ = load_evaluation()
    criteria = build_testing_criteria(configuration)

    assert ITEM_SCHEMA["additionalProperties"] is False
    assert [criterion["name"] for criterion in criteria] == ["grounded_observation", "correct_poll_decision"]
    assert [criterion["type"] for criterion in criteria] == ["label_model", "string_check"]


def test_pipeline_results_are_retained_before_cloud_grading(tmp_path):
    path = write_pipeline_results(tmp_path, [{"case_id": "routine-midfield-opening", "actual_poll": "false"}])

    assert path.name == "pipeline-results.json"
    assert '"case_id": "routine-midfield-opening"' in path.read_text()
