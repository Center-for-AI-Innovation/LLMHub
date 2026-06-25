import os
from unittest.mock import MagicMock, patch

# import pytest
from huggingface_hub.errors import GatedRepoError, RepositoryNotFoundError

from app.utils.hf_auth import (
    append_hf_token_to_env,
    check_model_hf_access,
    fetch_model_gating_status,
    verify_hf_model_repo_access,
)

# ---------------------------------------------------------------------------
# append_hf_token_to_env
# ---------------------------------------------------------------------------

def test_append_hf_token_to_env_empty_base():
    assert append_hf_token_to_env(None, "abc") == "HF_TOKEN=abc"


def test_append_hf_token_to_env_appends():
    assert append_hf_token_to_env("A=1", "tok") == "A=1,HF_TOKEN=tok"


# ---------------------------------------------------------------------------
# verify_hf_model_repo_access — unit tests (mocked HfApi)
# ---------------------------------------------------------------------------

def test_verify_access_public_model_mocked():
    with patch("app.utils.hf_auth.HfApi") as MockApi:
        MockApi.return_value.auth_check.return_value = None
        ok, err = verify_hf_model_repo_access("some/public-model", None)
    assert ok is True
    assert err is None


def _mock_response(status_code=403):
    resp = MagicMock()
    resp.status_code = status_code
    resp.headers = {}
    return resp


def test_verify_access_gated_no_token_mocked():
    with patch("app.utils.hf_auth.HfApi") as MockApi:
        MockApi.return_value.auth_check.side_effect = GatedRepoError("gated", response=_mock_response(403))
        ok, err = verify_hf_model_repo_access("org/gated-model", None)
    assert ok is False
    assert "gated" in err.lower()


def test_verify_access_repo_not_found_mocked():
    with patch("app.utils.hf_auth.HfApi") as MockApi:
        MockApi.return_value.auth_check.side_effect = RepositoryNotFoundError("not found", response=_mock_response(404))
        ok, err = verify_hf_model_repo_access("org/nonexistent", "some-token")
    assert ok is False
    assert "not found" in err.lower()


# ---------------------------------------------------------------------------
# fetch_model_gating_status — unit tests (mocked HfApi)
# ---------------------------------------------------------------------------

def test_fetch_gating_status_auto():
    mock_info = MagicMock()
    mock_info.gated = "auto"
    with patch("app.utils.hf_auth.HfApi") as MockApi:
        MockApi.return_value.repo_info.return_value = mock_info
        result = fetch_model_gating_status("org/model")
    assert result == "auto"


def test_fetch_gating_status_public():
    mock_info = MagicMock()
    mock_info.gated = False
    with patch("app.utils.hf_auth.HfApi") as MockApi:
        MockApi.return_value.repo_info.return_value = mock_info
        result = fetch_model_gating_status("org/public-model")
    assert result is None


def test_fetch_gating_status_api_error_returns_none():
    with patch("app.utils.hf_auth.HfApi") as MockApi:
        MockApi.return_value.repo_info.side_effect = Exception("network error")
        result = fetch_model_gating_status("org/model")
    assert result is None


# ---------------------------------------------------------------------------
# check_model_hf_access — logic branches (no network)
# ---------------------------------------------------------------------------

def test_check_access_no_huggingface_id():
    ok, err = check_model_hf_access(gated="auto", huggingface_id=None, user_token="tok")
    assert ok is True
    assert err is None


def test_check_access_not_gated():
    ok, err = check_model_hf_access(gated=None, huggingface_id="org/model", user_token=None)
    assert ok is True
    assert err is None


def test_check_access_gated_no_token():
    ok, err = check_model_hf_access(gated="manual", huggingface_id="org/model", user_token=None)
    assert ok is False
    assert "hf_token" in err.lower()


def test_check_access_gated_valid_token():
    with patch("app.utils.hf_auth.verify_hf_model_repo_access", return_value=(True, None)):
        ok, err = check_model_hf_access(gated="auto", huggingface_id="org/model", user_token="hf_abc")
    assert ok is True
    assert err is None


def test_check_access_gated_invalid_token():
    with patch("app.utils.hf_auth.verify_hf_model_repo_access", return_value=(False, "access denied")):
        ok, err = check_model_hf_access(gated="auto", huggingface_id="org/model", user_token="bad-token")
    assert ok is False
    assert err == "access denied"


# ---------------------------------------------------------------------------
# Integration tests — hit the real HF API (skipped without a token)
# ---------------------------------------------------------------------------

HF_TOKEN = os.environ.get("HF_TOKEN")

# @pytest.mark.skipif(not HF_TOKEN, reason="HF_TOKEN not set")
def test_verify_access_gated_model_with_real_token():
    """Requires a token that has been granted access to meta-llama/Meta-Llama-3.1-8B-Instruct."""
    ok, err = verify_hf_model_repo_access("meta-llama/Meta-Llama-3.1-8B-Instruct", HF_TOKEN)
    assert ok is True, f"Expected access but got: {err}"


# @pytest.mark.skipif(not HF_TOKEN, reason="HF_TOKEN not set")
def test_verify_access_gated_model_no_token():
    """A gated model should be denied when no token is provided."""
    ok, err = verify_hf_model_repo_access("meta-llama/Meta-Llama-3.1-8B-Instruct", None)
    assert ok is False
    assert err is not None


# @pytest.mark.skipif(HF_TOKEN is None, reason="always runs — public model")
def test_verify_hf_public_model_no_token():
    ok, err = verify_hf_model_repo_access("gpt2", None)
    assert ok is True
    assert err is None
