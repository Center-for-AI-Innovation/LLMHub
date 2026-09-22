from datetime import datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.config.config import settings
from app.models.available_model import AvailableModel
from app.models.model_deployment import ModelDeployment
from app.utils import model_cache


@pytest.fixture
def db():
    """A real SQLite session with the real ORM models.

    The launch-history query is the half of this module that talks to the
    database, so it is exercised for real rather than mocked -- a wrong column
    name would otherwise ship green.
    """
    engine = create_engine("sqlite://")
    AvailableModel.__table__.create(engine)
    ModelDeployment.__table__.create(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


def _launch(db, model_id, repo_id, launched_at):
    """Record a launch, adding the catalog row the first time we see the model."""
    if db.get(AvailableModel, model_id) is None:
        db.add(
            AvailableModel(
                id=model_id,
                name=model_id,
                type="small",
                family="test",
                variant="",
                modelType="LLM",
                specs={},
                huggingfaceId=repo_id,
            )
        )
    db.add(
        ModelDeployment(
            modelId=model_id,
            modelName=model_id,
            slurmJobId="1",
            status="ready",
            userId=uuid4(),
            createdAt=launched_at,
        )
    )
    db.commit()


def _repo(repo_id, size=1_000_000_000):
    """Stands in for huggingface_hub's CachedRepoInfo."""
    return SimpleNamespace(
        repo_id=repo_id,
        size_on_disk=size,
        size_on_disk_str=f"{size / 1e9:.1f}G",
        revisions=[SimpleNamespace(commit_hash=f"rev-{repo_id}")],
    )


def _fake_cache(monkeypatch, repos, freed=0):
    deleted = []
    cache_info = SimpleNamespace(
        repos=repos,
        warnings=[],
        delete_revisions=lambda *hashes: SimpleNamespace(
            expected_freed_size=freed,
            execute=lambda: deleted.extend(hashes),
        ),
    )
    monkeypatch.setattr(model_cache, "scan_cache_dir", lambda _dir: cache_info)
    return deleted


# --- cache directory resolution (no mocks: this is what silently resolved to a
# personal directory when it was inferred from environment.yaml) ---


def test_cache_dir_comes_from_settings(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "MODEL_CACHE_DIR", str(tmp_path))
    assert model_cache.resolve_cache_dir() == tmp_path


def test_cache_dir_override_wins(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "MODEL_CACHE_DIR", "/some/other/place")
    assert model_cache.resolve_cache_dir(str(tmp_path)) == tmp_path


def test_cache_dir_unset_refuses_to_guess(monkeypatch):
    monkeypatch.setattr(settings, "MODEL_CACHE_DIR", None)
    with pytest.raises(RuntimeError, match="never inferred"):
        model_cache.resolve_cache_dir()


def test_cache_dir_must_exist(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "MODEL_CACHE_DIR", str(tmp_path / "nope"))
    with pytest.raises(RuntimeError, match="does not exist"):
        model_cache.resolve_cache_dir()


# --- launch history ---


def test_last_launched_keys_on_repo_id_and_takes_the_newest(db):
    now = datetime.utcnow()
    _launch(db, "Qwen3-8B", "Qwen/Qwen3-8B", now - timedelta(days=200))
    _launch(db, "Qwen3-8B", "Qwen/Qwen3-8B", now - timedelta(days=2))

    assert model_cache.last_launched_by_repo(db) == {
        "Qwen/Qwen3-8B": now - timedelta(days=2)
    }


def test_models_without_a_repo_id_are_absent(db):
    _launch(db, "Mystery-7B", None, datetime.utcnow())

    assert model_cache.last_launched_by_repo(db) == {}


# --- eviction ---


def test_evicts_only_models_past_the_cutoff(db, monkeypatch, tmp_path):
    now = datetime.utcnow()
    _launch(db, "Qwen3-8B", "Qwen/Qwen3-8B", now - timedelta(days=200))
    _launch(db, "Phi-3.5-mini-instruct", "microsoft/Phi-3.5-mini-instruct", now)
    deleted = _fake_cache(
        monkeypatch,
        [_repo("Qwen/Qwen3-8B"), _repo("microsoft/Phi-3.5-mini-instruct")],
        freed=900_000_000,
    )

    result = model_cache.evict_unused_models(db, tmp_path, max_age_days=90)

    assert result["evicted"] == ["Qwen/Qwen3-8B"]
    assert result["kept"] == ["microsoft/Phi-3.5-mini-instruct"]
    assert result["freed_bytes"] == 900_000_000
    assert deleted == ["rev-Qwen/Qwen3-8B"]


def test_matching_is_by_full_repo_id_not_model_name(db, monkeypatch, tmp_path):
    """A same-named repo under a different org must not inherit launch history.

    Deployments record the bare name, the cache is keyed by repo id; joining on
    the name would evict a hand-staged fork because the official repo went cold.
    """
    now = datetime.utcnow()
    _launch(db, "Qwen3-8B", "Qwen/Qwen3-8B", now - timedelta(days=200))
    deleted = _fake_cache(monkeypatch, [_repo("someone-else/Qwen3-8B")])

    result = model_cache.evict_unused_models(db, tmp_path, max_age_days=90)

    assert result["unmatched"] == ["someone-else/Qwen3-8B"]
    assert result["evicted"] == []
    assert deleted == []


def test_never_launched_models_are_left_alone(db, monkeypatch, tmp_path):
    deleted = _fake_cache(monkeypatch, [_repo("someone/hand-staged-model")])

    result = model_cache.evict_unused_models(db, tmp_path, max_age_days=90)

    assert result["unmatched"] == ["someone/hand-staged-model"]
    assert deleted == []


def test_dry_run_reports_without_deleting(db, monkeypatch, tmp_path):
    now = datetime.utcnow()
    _launch(db, "Qwen3-8B", "Qwen/Qwen3-8B", now - timedelta(days=200))
    deleted = _fake_cache(monkeypatch, [_repo("Qwen/Qwen3-8B")], freed=2_000_000_000)

    result = model_cache.evict_unused_models(
        db, tmp_path, max_age_days=90, dry_run=True
    )

    assert result["evicted"] == ["Qwen/Qwen3-8B"]
    assert result["freed_bytes"] == 2_000_000_000
    assert deleted == []
