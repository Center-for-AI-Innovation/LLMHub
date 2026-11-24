"""SSRF guards for the Hugging Face metadata fetch (fake httpx client, no network).

``model_id`` / ``revision`` come from API callers and are spliced into a
huggingface.co URL, and ``/resolve/`` responses redirect to the Hub CDN. These
tests pin down that (a) only plain ``org/name`` ids and short refs build a URL,
(b) redirects are followed only to https Hugging Face hosts, and (c) the user's
token is sent to huggingface.co only.
"""

from __future__ import annotations

from typing import Any

import pytest

import app.services.fit_estimator.model_metadata as mm
from app.services.fit_estimator.model_metadata import (
    _resolve_url,
    clear_metadata_cache,
    fetch_model_metadata,
)

_TINY_CONFIG = {
    "num_hidden_layers": 2,
    "hidden_size": 64,
    "num_attention_heads": 4,
    "max_position_embeddings": 128,
    "torch_dtype": "bfloat16",
    "vocab_size": 100,
}

CONFIG_URL = "https://huggingface.co/org/model/resolve/main/config.json"


# --------------------------------------------------------------------------- #
# URL construction                                                             #
# --------------------------------------------------------------------------- #


def test_resolve_url_plain_repo_and_revision() -> None:
    assert _resolve_url("org/model", "config.json", "main") == CONFIG_URL


def test_resolve_url_quotes_multi_segment_revision() -> None:
    url = _resolve_url("org/model", "config.json", "refs/pr/12")
    assert url == "https://huggingface.co/org/model/resolve/refs/pr/12/config.json"


def test_resolve_url_accepts_commit_sha_and_dotted_tags() -> None:
    sha = "0123456789abcdef0123456789abcdef01234567"
    assert sha in _resolve_url("org/model", "config.json", sha)
    assert "/v1.0-rc.2/" in _resolve_url("org/model", "config.json", "v1.0-rc.2")


@pytest.mark.parametrize(
    "model_id",
    [
        "",
        "model",  # no org
        "org/model/extra",  # too many segments
        "org/../etc",
        "org/model/..",
        "../org/model",
        "org/mo..del",
        "org/model?x=1",
        "org/model#frag",
        "org/model%2F..",
        "https://evil.example/org/model",
        "org//model",
        ".hidden/model",
        "org/model name",
        "org/" + "m" * 200,
    ],
)
def test_resolve_url_rejects_bad_model_ids(model_id: str) -> None:
    with pytest.raises(ValueError, match="invalid Hugging Face model id"):
        _resolve_url(model_id, "config.json", "main")


@pytest.mark.parametrize(
    "revision",
    [
        "",
        "..",
        "../../other/repo",
        "main/../../x",
        "main?download=true",
        "a/b/c/d",  # more segments than refs/pr/N
        "main#x",
        "ma in",
        "/main",
    ],
)
def test_resolve_url_rejects_bad_revisions(revision: str) -> None:
    with pytest.raises(ValueError, match="invalid Hugging Face revision"):
        _resolve_url("org/model", "config.json", revision)


def test_fetch_rejects_bad_model_id_before_any_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import httpx

    def _boom(**kwargs: Any) -> Any:
        raise AssertionError("no HTTP client should be created")

    monkeypatch.setattr(httpx, "Client", _boom)
    clear_metadata_cache()
    with pytest.raises(ValueError, match="invalid Hugging Face model id"):
        fetch_model_metadata("org/../private")


# --------------------------------------------------------------------------- #
# Redirect handling                                                            #
# --------------------------------------------------------------------------- #


class _Response:
    def __init__(
        self,
        status_code: int,
        payload: Any = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.status_code = status_code
        self._payload = payload
        self.headers = headers or {}

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self) -> Any:
        return self._payload


class _Stream(_Response):
    def __enter__(self) -> "_Stream":
        return self

    def __exit__(self, *args: Any) -> bool:
        return False

    def iter_bytes(self):
        return iter(())


class _RedirectingClient:
    """Serves ``config.json`` via a redirect; records every (url, headers)."""

    redirect_to: str = ""
    requests: list[tuple[str, dict[str, str]]] = []
    redirect_status: int = 302

    def __init__(self, **kwargs: Any) -> None:
        assert kwargs.get("follow_redirects") is False
        assert "headers" not in kwargs

    def __enter__(self) -> "_RedirectingClient":
        return self

    def __exit__(self, *args: Any) -> bool:
        return False

    def get(self, url: str, headers: Any = None, **kwargs: Any) -> _Response:
        type(self).requests.append((url, dict(headers or {})))
        if url == CONFIG_URL:
            return _Response(
                type(self).redirect_status, headers={"location": type(self).redirect_to}
            )
        if "config.json" in url:  # redirected target may carry a query string
            return _Response(200, dict(_TINY_CONFIG))
        return _Response(404)

    def stream(self, method: str, url: str, headers: Any = None) -> _Stream:
        type(self).requests.append((url, dict(headers or {})))
        return _Stream(404)


@pytest.fixture
def redirecting_client(monkeypatch: pytest.MonkeyPatch) -> type[_RedirectingClient]:
    import httpx

    monkeypatch.setattr(httpx, "Client", _RedirectingClient)
    _RedirectingClient.requests = []
    _RedirectingClient.redirect_status = 302
    clear_metadata_cache()
    return _RedirectingClient


@pytest.mark.parametrize(
    "target",
    [
        "https://cdn-lfs.hf.co/repos/abc/config.json?X-Amz-Signature=sig",
        "https://cdn-lfs-us-1.huggingface.co/repos/abc/config.json",
        "https://hf.co/org/model/resolve/main/config.json",
    ],
)
def test_redirect_to_hf_cdn_is_followed(
    redirecting_client: type[_RedirectingClient], target: str
) -> None:
    redirecting_client.redirect_to = target
    meta = fetch_model_metadata("org/model")
    assert meta.n_layers == 2
    assert redirecting_client.requests[1][0] == target


def test_relative_redirect_resolves_against_hub(
    redirecting_client: type[_RedirectingClient],
) -> None:
    redirecting_client.redirect_to = "/org/model/resolve/abc123/config.json"
    fetch_model_metadata("org/model")
    assert (
        redirecting_client.requests[1][0]
        == "https://huggingface.co/org/model/resolve/abc123/config.json"
    )


@pytest.mark.parametrize(
    "target",
    [
        "https://evil.example/config.json",
        "https://huggingface.co.evil.example/config.json",
        "https://attacker-hf.co/config.json",
        "https://169.254.169.254/latest/meta-data/",
        "https://localhost:8000/api/models",
        "http://huggingface.co/org/model/resolve/main/config.json",  # not https
        "file:///etc/passwd",
    ],
)
def test_redirect_off_allowlist_is_refused(
    redirecting_client: type[_RedirectingClient], target: str
) -> None:
    redirecting_client.redirect_to = target
    with pytest.raises(ValueError, match="refusing redirect"):
        fetch_model_metadata("org/model")
    # The forbidden hop was never requested.
    assert all(url != target for url, _ in redirecting_client.requests)


@pytest.mark.parametrize("status", [301, 303, 307, 308])
def test_all_redirect_statuses_are_checked(
    redirecting_client: type[_RedirectingClient], status: int
) -> None:
    redirecting_client.redirect_status = status
    redirecting_client.redirect_to = "https://evil.example/x"
    with pytest.raises(ValueError, match="refusing redirect"):
        fetch_model_metadata("org/model")


def test_redirect_loop_is_bounded(
    redirecting_client: type[_RedirectingClient],
) -> None:
    redirecting_client.redirect_to = CONFIG_URL  # redirects to itself
    with pytest.raises(ValueError, match="too many redirects"):
        fetch_model_metadata("org/model")
    assert len(redirecting_client.requests) == mm._MAX_REDIRECTS + 1


def test_token_sent_to_hub_only_not_to_cdn(
    redirecting_client: type[_RedirectingClient],
) -> None:
    redirecting_client.redirect_to = (
        "https://cdn-lfs.hf.co/repos/abc/config.json?X-Amz-Signature=sig"
    )
    fetch_model_metadata("org/model", token="hf_user_a")
    first_url, first_headers = redirecting_client.requests[0]
    second_url, second_headers = redirecting_client.requests[1]
    assert first_url == CONFIG_URL
    assert first_headers.get("Authorization") == "Bearer hf_user_a"
    assert second_url.startswith("https://cdn-lfs.hf.co/")
    assert "Authorization" not in second_headers
