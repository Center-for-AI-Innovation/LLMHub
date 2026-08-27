"""TTL cache behavior for fetch_model_metadata (fake httpx client, no network)."""

from __future__ import annotations

from typing import Any

import pytest

from app.services.fit_estimator.model_metadata import (
    clear_metadata_cache,
    fetch_model_metadata,
)

_TINY_CONFIG = {
    "num_hidden_layers": 2,
    "num_attention_heads": 2,
    "hidden_size": 64,
    "intermediate_size": 128,
    "max_position_embeddings": 2048,
    "torch_dtype": "bfloat16",
    "vocab_size": 100,
}


class _FakeResponse:
    def __init__(self, status_code: int = 200, payload: Any = None) -> None:
        self.status_code = status_code
        self._payload = payload

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self) -> Any:
        return self._payload


class _FakeStream:
    status_code = 404

    def __enter__(self) -> "_FakeStream":
        return self

    def __exit__(self, *args: Any) -> bool:
        return False

    def raise_for_status(self) -> None:
        pass

    def iter_bytes(self):
        return iter(())


class _FakeClient:
    calls = 0

    def __init__(self, **kwargs: Any) -> None:
        pass

    def __enter__(self) -> "_FakeClient":
        return self

    def __exit__(self, *args: Any) -> bool:
        return False

    def get(self, url: str, **kwargs: Any) -> _FakeResponse:
        type(self).calls += 1
        if url.endswith("config.json"):
            return _FakeResponse(200, dict(_TINY_CONFIG))
        return _FakeResponse(404)

    def stream(self, method: str, url: str, **kwargs: Any) -> _FakeStream:
        type(self).calls += 1
        return _FakeStream()


def test_metadata_cache_avoids_refetch(monkeypatch: pytest.MonkeyPatch) -> None:
    import httpx

    monkeypatch.setattr(httpx, "Client", _FakeClient)
    _FakeClient.calls = 0
    clear_metadata_cache()

    first = fetch_model_metadata("org/model")
    assert _FakeClient.calls > 0
    calls_after_first = _FakeClient.calls

    second = fetch_model_metadata("org/model")
    assert _FakeClient.calls == calls_after_first  # served from cache
    assert second is first

    fetch_model_metadata("org/model", revision="v2")  # distinct cache key
    assert _FakeClient.calls > calls_after_first


class _FailingClient(_FakeClient):
    def get(self, url: str, **kwargs: Any) -> _FakeResponse:
        type(self).calls += 1
        return _FakeResponse(404)  # config.json missing -> fetch raises


def test_metadata_cache_never_caches_failures(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A transient outage must not stick for the TTL."""
    import httpx

    monkeypatch.setattr(httpx, "Client", _FailingClient)
    _FailingClient.calls = 0
    clear_metadata_cache()

    for _ in range(2):
        with pytest.raises(ValueError):
            fetch_model_metadata("org/broken")
    assert _FailingClient.calls == 2  # both attempts hit the network


def test_metadata_cache_evicts_at_max_entries(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import httpx

    from app.services.fit_estimator import model_metadata as mm

    monkeypatch.setattr(httpx, "Client", _FakeClient)
    monkeypatch.setattr(mm, "_METADATA_CACHE_MAX_ENTRIES", 2)
    _FakeClient.calls = 0
    clear_metadata_cache()

    fetch_model_metadata("org/m1")
    fetch_model_metadata("org/m2")
    fetch_model_metadata("org/m3")  # evicts oldest (m1)
    assert len(mm._metadata_cache) == 2

    calls_before = _FakeClient.calls
    fetch_model_metadata("org/m3")  # still cached
    assert _FakeClient.calls == calls_before
    fetch_model_metadata("org/m1")  # evicted -> refetch
    assert _FakeClient.calls > calls_before


def test_forbidden_403_mentions_license(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.services.fit_estimator.model_metadata import _fetch_json

    class _Forbidden:
        status_code = 403

    class _Client:
        def get(self, url: str, **kwargs: Any) -> Any:
            return _Forbidden()

    with pytest.raises(ValueError, match="license"):
        _fetch_json(_Client(), "https://huggingface.co/org/gated/config.json")


def test_oversized_safetensors_header_rejected() -> None:
    """An absurd header length (corrupt file / HTML error page) must degrade to
    None without attempting to buffer it."""
    import struct

    from app.services.fit_estimator.model_metadata import (
        _fetch_safetensors_header_total,
    )

    class _Stream:
        status_code = 200

        def __init__(self, payload: bytes) -> None:
            self._payload = payload

        def __enter__(self) -> "_Stream":
            return self

        def __exit__(self, *a: Any) -> bool:
            return False

        def raise_for_status(self) -> None:
            pass

        def iter_bytes(self):
            yield self._payload

    class _Client:
        second_request = False

        def stream(self, method: str, url: str, headers: Any = None) -> _Stream:
            if headers and headers.get("Range") == "bytes=0-7":
                return _Stream(struct.pack("<Q", 10**12))  # 1 TB "header"
            type(self).second_request = True
            return _Stream(b"")

    _Client.second_request = False
    assert _fetch_safetensors_header_total(_Client(), "org/m", "main") is None
    assert _Client.second_request is False  # bailed before fetching the body
