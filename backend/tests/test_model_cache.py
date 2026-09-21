from app.config.config import settings
from app.utils import model_cache


def _make_weights_dir(root, model_name):
    model_dir = root / model_name
    model_dir.mkdir(parents=True)
    (model_dir / "config.json").write_text("{}")
    return model_dir


def _setup(monkeypatch, tmp_path, models_yaml, gated_repos=()):
    public_root = tmp_path / "public"
    public_root.mkdir()
    config_path = tmp_path / "models.yaml"
    config_path.write_text(models_yaml)

    monkeypatch.setattr(settings, "HF_TOKEN", "hf_test")
    monkeypatch.setattr(model_cache, "resolve_public_weights_root", lambda: public_root)
    monkeypatch.setattr(model_cache, "resolve_models_config_path", lambda: config_path)
    monkeypatch.setattr(
        model_cache,
        "fetch_model_gating_status",
        lambda repo_id: "manual" if repo_id in gated_repos else None,
    )

    downloads = []
    monkeypatch.setattr(
        model_cache, "snapshot_download", lambda **kwargs: downloads.append(kwargs)
    )
    return public_root, downloads


# RE ADD AFTER GATED PR FIX
# Replace this with a test that gated models are downloaded into
# MODEL_STORE_ROOT rather than skipped.
def test_sync_downloads_public_models_and_skips_gated(monkeypatch, tmp_path):
    public_root, downloads = _setup(
        monkeypatch,
        tmp_path,
        """
models:
  Llama-3.1-8B:
    hf_model: meta-llama/Llama-3.1-8B
  Qwen3-8B:
    hf_model: Qwen/Qwen3-8B
""",
        gated_repos={"meta-llama/Llama-3.1-8B"},
    )

    result = model_cache.sync_model_cache()

    assert result["synced"] == ["Qwen3-8B"]
    assert result["skipped"] == ["Llama-3.1-8B"]
    assert [call["local_dir"] for call in downloads] == [public_root / "Qwen3-8B"]
    assert downloads[0]["token"] == "hf_test"


def test_prune_removes_weights_dropped_from_models_yaml(monkeypatch, tmp_path):
    public_root, _ = _setup(
        monkeypatch,
        tmp_path,
        """
models:
  Qwen3-8B:
    hf_model: Qwen/Qwen3-8B
""",
    )
    stale_dir = _make_weights_dir(public_root, "Llama-2-7b-hf")

    result = model_cache.sync_model_cache()

    assert result["removed"] == ["Llama-2-7b-hf"]
    assert not stale_dir.exists()


def test_prune_keeps_listed_models_and_other_caches(monkeypatch, tmp_path):
    public_root, _ = _setup(
        monkeypatch,
        tmp_path,
        """
models:
  Llama-3.1-8B:
    hf_model: meta-llama/Llama-3.1-8B
  Qwen3-8B:
    hf_model: Qwen/Qwen3-8B
""",
        gated_repos={"meta-llama/Llama-3.1-8B"},
    )
    # A gated model we skip this run must survive, as must the sibling caches
    # that live alongside the weights.
    gated_dir = _make_weights_dir(public_root, "Llama-3.1-8B")
    hf_cache = public_root / "huggingface"
    hf_cache.mkdir()

    result = model_cache.sync_model_cache()

    assert result["removed"] == []
    assert gated_dir.exists()
    assert hf_cache.exists()


def test_dry_run_downloads_and_deletes_nothing(monkeypatch, tmp_path):
    public_root, downloads = _setup(
        monkeypatch,
        tmp_path,
        """
models:
  Qwen3-8B:
    hf_model: Qwen/Qwen3-8B
""",
    )
    stale_dir = _make_weights_dir(public_root, "Llama-2-7b-hf")

    result = model_cache.sync_model_cache(dry_run=True)

    assert result["synced"] == ["Qwen3-8B"]
    assert result["removed"] == ["Llama-2-7b-hf"]
    assert downloads == []
    assert stale_dir.exists()
