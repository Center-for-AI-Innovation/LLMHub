"""Hugging Face Hub access checks for model deployments (gated/private repos)."""

from typing import Optional, Tuple

from huggingface_hub import HfApi
from huggingface_hub.errors import GatedRepoError, HfHubHTTPError, RepositoryNotFoundError

from app.config.logging import get_logger

logger = get_logger("hf_auth")


def fetch_model_gating_status(huggingface_id: str) -> Optional[str]:
    """Return the gating status of a HF repo: 'auto', 'manual', or None (public).

    Uses repo_info with expand=["gated"] which is the only reliable way to
    populate the gated field per the HF Hub docs.  Returns None on any error
    so callers can fall back to a cached value rather than blocking launches.
    """
    try:
        api = HfApi()
        info = api.repo_info(repo_id=huggingface_id, repo_type="model", expand=["gated"])
        gated = getattr(info, "gated", None)
        return str(gated) if gated else None
    except Exception as e:
        logger.warning("Failed to fetch gating status for %s: %s", huggingface_id, e)
        return None


def verify_hf_model_repo_access(repo_id: str, token: Optional[str]) -> Tuple[bool, Optional[str]]:
    """Return (True, None) if the Hub allows access; otherwise (False, error message).

    Uses :meth:`huggingface_hub.HfApi.auth_check` against ``repo_type="model"`` (same
    behavior as the root ``auth_check`` helper in the Hub docs).

    ``GatedRepoError`` must be caught before ``RepositoryNotFoundError`` because it
    subclasses the latter.

    Pass ``token`` for gated or private models the user has been granted access to on
    the Hub. For public models, ``token`` may be omitted (unauthenticated check).
    """
    try:
        api = HfApi()
        api.auth_check(repo_id, repo_type="model", token=token if token else False)
        return True, None
    except GatedRepoError as e:
        logger.warning("HF auth_check gated repo repo_id=%s: %s", repo_id, e)
        return False, (
            "You do not have permission to access this gated repository. "
            "Accept the model conditions on the Hub and pass hf_token with access."
        )
    except RepositoryNotFoundError as e:
        logger.warning("HF auth_check repo missing or inaccessible repo_id=%s: %s", repo_id, e)
        return False, (
            "The repository was not found, or you do not have access "
            "(private repo, wrong id, or missing token)."
        )
    except HfHubHTTPError as e:
        logger.warning("HF auth_check HTTP error repo_id=%s: %s", repo_id, e)
        return False, str(e)
    except Exception as e:
        logger.error("HF auth_check unexpected error for repo_id=%s: %s", repo_id, e)
        return False, str(e)


def check_model_hf_access(
    gated: Optional[str],
    huggingface_id: Optional[str],
    user_token: Optional[str],
) -> Tuple[bool, Optional[str]]:
    """Return (has_access, error_message) using the cached gating status.

    - No huggingface_id → no HF interaction needed, allow.
    - gated is None → public model, allow.
    - gated and token provided → call auth_check to verify access.
    - gated and no token → deny with a clear message.
    """
    if not huggingface_id:
        return True, None
    if not gated:
        return True, None
    if not user_token:
        return False, (
            f"This model requires Hugging Face Hub access (gating: {gated}). "
            "Supply an hf_token that has been granted access on the Hub."
        )
    return verify_hf_model_repo_access(huggingface_id, user_token)


def append_hf_token_to_env(env_value: Optional[str], hf_token: str) -> str:
    """Append ``HF_TOKEN=...`` to vec-inf's comma-separated ``env`` string."""
    pair = f"HF_TOKEN={hf_token}"
    if not env_value:
        return pair
    return f"{env_value},{pair}"
