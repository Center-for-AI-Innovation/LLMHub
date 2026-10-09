from app.utils.hf_family_orgs import FAMILY_TO_HF_ORG, resolve_hf_model


def test_explicit_hf_model_always_wins():
    assert (
        resolve_hf_model("Qwen2.5", "Qwen2.5-0.5B-Instruct", "custom-org/custom-repo")
        == "custom-org/custom-repo"
    )


def test_falls_back_to_family_org_when_no_explicit_hf_model():
    assert (
        resolve_hf_model("Qwen2.5", "Qwen2.5-99B-Instruct", None)
        == "Qwen/Qwen2.5-99B-Instruct"
    )


def test_unknown_family_and_no_explicit_hf_model_resolves_to_none():
    assert (
        resolve_hf_model("some-brand-new-family", "some-brand-new-model", None) is None
    )


def test_every_known_family_maps_to_a_non_empty_org():
    assert len(FAMILY_TO_HF_ORG) > 0
    for family, org in FAMILY_TO_HF_ORG.items():
        assert family and org
