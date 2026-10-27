import os
import shutil
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.config.config import Settings, settings
from app.models.available_model import AvailableModel
from app.models.model_deployment import ModelDeployment
from app.services import background_service, cache_management_service


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


COMPLETE = cache_management_service._PUBLIC_CACHE_COMPLETE_MARKER


def _repo(repo_id, size=1_000_000_000, cache_dir=Path("/nonexistent")):
    """Stands in for huggingface_hub's CachedRepoInfo."""
    return SimpleNamespace(
        repo_id=repo_id,
        repo_path=cache_dir / ("models--" + repo_id.replace("/", "--")),
        size_on_disk=size,
        size_on_disk_str=f"{size / 1e9:.1f}G",
        revisions=[SimpleNamespace(commit_hash=f"rev-{repo_id}")],
    )


def _fake_cache(monkeypatch, repos, freed=0, downloading=(), on_execute=None):
    """Fake the scan, the delete, and which repos the backend is downloading."""
    deleted = []

    def execute(hashes):
        deleted.extend(hashes)
        if on_execute:
            on_execute()

    cache_info = SimpleNamespace(
        repos=repos,
        warnings=[],
        delete_revisions=lambda *hashes: SimpleNamespace(
            expected_freed_size=freed,
            execute=lambda: execute(hashes),
        ),
    )
    monkeypatch.setattr(
        cache_management_service, "scan_cache_dir", lambda _dir: cache_info
    )
    monkeypatch.setattr(
        cache_management_service,
        "public_model_download_state",
        lambda repo_id: ("downloading" if repo_id in downloading else "missing", None),
    )
    return deleted


# --- cache directory resolution (no mocks: this is what silently resolved to a
# personal directory when it was inferred from environment.yaml) ---


def test_cache_dir_comes_from_settings(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "MODEL_CACHE_DIR", str(tmp_path))
    assert cache_management_service.resolve_cache_dir() == tmp_path


def test_cache_dir_override_wins(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "MODEL_CACHE_DIR", "/some/other/place")
    assert cache_management_service.resolve_cache_dir(str(tmp_path)) == tmp_path


def test_cache_dir_unset_refuses_to_guess(monkeypatch):
    monkeypatch.setattr(settings, "MODEL_CACHE_DIR", None)
    with pytest.raises(RuntimeError, match="never inferred"):
        cache_management_service.resolve_cache_dir()


def test_cache_dir_must_exist(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "MODEL_CACHE_DIR", str(tmp_path / "nope"))
    with pytest.raises(RuntimeError, match="does not exist"):
        cache_management_service.resolve_cache_dir()


# --- launch history ---


def test_last_launched_keys_on_repo_id_and_takes_the_newest(db):
    now = datetime.utcnow()
    _launch(db, "Qwen3-8B", "Qwen/Qwen3-8B", now - timedelta(days=200))
    _launch(db, "Qwen3-8B", "Qwen/Qwen3-8B", now - timedelta(days=2))

    assert cache_management_service.last_launched_by_repo(db) == {
        "Qwen/Qwen3-8B": now - timedelta(days=2)
    }


def test_models_without_a_repo_id_are_absent(db):
    _launch(db, "Mystery-7B", None, datetime.utcnow())

    assert cache_management_service.last_launched_by_repo(db) == {}


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

    result = cache_management_service.evict_unused_models(db, tmp_path, max_age_days=90)

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

    result = cache_management_service.evict_unused_models(db, tmp_path, max_age_days=90)

    assert result["unmatched"] == ["someone-else/Qwen3-8B"]
    assert result["evicted"] == []
    assert deleted == []


def test_never_launched_models_are_left_alone(db, monkeypatch, tmp_path):
    deleted = _fake_cache(monkeypatch, [_repo("someone/hand-staged-model")])

    result = cache_management_service.evict_unused_models(db, tmp_path, max_age_days=90)

    assert result["unmatched"] == ["someone/hand-staged-model"]
    assert deleted == []


def test_dry_run_reports_without_deleting(db, monkeypatch, tmp_path):
    now = datetime.utcnow()
    _launch(db, "Qwen3-8B", "Qwen/Qwen3-8B", now - timedelta(days=200))
    deleted = _fake_cache(monkeypatch, [_repo("Qwen/Qwen3-8B")], freed=2_000_000_000)

    result = cache_management_service.evict_unused_models(
        db, tmp_path, max_age_days=90, dry_run=True
    )

    assert result["evicted"] == ["Qwen/Qwen3-8B"]
    assert result["freed_bytes"] == 2_000_000_000
    assert deleted == []


def test_model_being_downloaded_is_not_evicted(db, monkeypatch, tmp_path):
    # Launched again a moment ago: the download has started, but the new launch
    # row isn't saved yet, so its history still looks 200 days old.
    _launch(db, "Qwen3-8B", "Qwen/Qwen3-8B", datetime.utcnow() - timedelta(days=200))
    deleted = _fake_cache(
        monkeypatch, [_repo("Qwen/Qwen3-8B")], downloading={"Qwen/Qwen3-8B"}
    )

    result = cache_management_service.evict_unused_models(db, tmp_path, max_age_days=90)

    assert result["kept"] == ["Qwen/Qwen3-8B"]
    assert deleted == []


def test_model_is_no_longer_complete_while_it_is_deleted(db, monkeypatch, tmp_path):
    """If the delete is cut short, launches must download the model again rather
    than trust a half-deleted one."""
    _launch(db, "Qwen3-8B", "Qwen/Qwen3-8B", datetime.utcnow() - timedelta(days=200))
    repo = _repo("Qwen/Qwen3-8B", cache_dir=tmp_path)
    repo.repo_path.mkdir()
    (repo.repo_path / COMPLETE).touch()
    complete_during_delete = []

    def delete():
        complete_during_delete.append((repo.repo_path / COMPLETE).exists())
        shutil.rmtree(repo.repo_path)

    _fake_cache(monkeypatch, [repo], on_execute=delete)

    cache_management_service.evict_unused_models(db, tmp_path, max_age_days=90)

    assert complete_during_delete == [False]


def test_models_that_cant_be_deleted_are_reported_not_counted(
    db, monkeypatch, tmp_path
):
    """One stuck model must not block the rest, or be logged as deleted."""
    old = datetime.utcnow() - timedelta(days=200)
    for name in ("gone", "stuck", "survivor"):
        _launch(db, name, f"org/{name}", old)
    stuck = _repo("org/stuck", cache_dir=tmp_path)
    (stuck.repo_path / COMPLETE).mkdir(parents=True)  # unlink() can't remove it
    survivor = _repo("org/survivor", cache_dir=tmp_path)
    survivor.repo_path.mkdir()  # the fake delete leaves it in place
    gone = _repo("org/gone")  # under /nonexistent, so already gone
    deleted = _fake_cache(monkeypatch, [gone, stuck, survivor], freed=10)

    result = cache_management_service.evict_unused_models(db, tmp_path, max_age_days=90)

    assert result["evicted"] == ["org/gone"]
    assert result["failed"] == ["org/stuck", "org/survivor"]
    assert "rev-org/stuck" not in deleted  # skipped, not attempted
    assert result["freed_bytes"] == 10  # only what actually went


# --- gated store ---


def _user_copy(workspace, user, model):
    copy = workspace / user / "model-weights" / model
    copy.mkdir(parents=True)
    (copy / "weights").write_text("w")
    return copy


def test_gated_eviction_deletes_only_cold_models(db, monkeypatch, tmp_path):
    """Users' hard-linked copies of a deleted model are deleted too."""
    _launch(db, "Old-7B", "org/old", datetime.utcnow() - timedelta(days=200))
    _launch(db, "New-7B", "org/new", datetime.utcnow())
    store, workspace = tmp_path / "store", tmp_path / "workspace"
    for name in ("Old-7B", "New-7B", "Hand-7B", "Down-7B.partial", "Cut-7B.evicting"):
        (store / name).mkdir(parents=True)
    old_copy = _user_copy(workspace, "alice", "Old-7B")
    new_copy = _user_copy(workspace, "alice", "New-7B")
    (workspace / "bob").mkdir()
    monkeypatch.setattr(
        cache_management_service,
        "_resolve_impersonated_workspace_root",
        lambda: workspace,
    )

    result = cache_management_service.evict_unused_gated_models(db, store, 90)

    assert result == {
        "evicted": ["Old-7B"],
        "kept": ["New-7B"],
        "unmatched": ["Hand-7B"],
        "failed": [],
    }
    remaining = sorted(p.name for p in store.iterdir())
    assert remaining == ["Down-7B.partial", "Hand-7B", "New-7B"]
    assert not old_copy.exists()
    assert new_copy.exists()


def test_gated_delete_does_not_follow_a_symlinked_model_weights(
    db, monkeypatch, tmp_path
):
    """A user points model-weights at someone else's copy."""
    _launch(db, "Old-7B", "org/old", datetime.utcnow() - timedelta(days=200))
    store, workspace = tmp_path / "store", tmp_path / "workspace"
    (store / "Old-7B").mkdir(parents=True)
    other = _user_copy(tmp_path, "elsewhere", "Old-7B")
    (workspace / "mallory").mkdir(parents=True)
    (workspace / "mallory" / "model-weights").symlink_to(other.parent)
    monkeypatch.setattr(
        cache_management_service,
        "_resolve_impersonated_workspace_root",
        lambda: workspace,
    )

    cache_management_service.evict_unused_gated_models(db, store, 90)

    assert other.exists()


def test_gated_dry_run_deletes_nothing(db, monkeypatch, tmp_path):
    _launch(db, "Old-7B", "org/old", datetime.utcnow() - timedelta(days=200))
    store, workspace = tmp_path / "store", tmp_path / "workspace"
    (store / "Old-7B").mkdir(parents=True)
    (store / "Cut-7B.evicting").mkdir()
    copy = _user_copy(workspace, "alice", "Old-7B")
    monkeypatch.setattr(
        cache_management_service,
        "_resolve_impersonated_workspace_root",
        lambda: workspace,
    )

    result = cache_management_service.evict_unused_gated_models(
        db, store, 90, dry_run=True
    )

    assert result["evicted"] == ["Old-7B"]
    assert sorted(p.name for p in store.iterdir()) == ["Cut-7B.evicting", "Old-7B"]
    assert copy.exists()


# --- compile cache ---


def _cache_file(path, age_days, read_days_ago=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"x" * 10)
    mtime = (datetime.now() - timedelta(days=age_days)).timestamp()
    atime = (datetime.now() - timedelta(days=read_days_ago or age_days)).timestamp()
    os.utime(path, (atime, mtime))


def test_compile_cache_removes_only_fully_stale_dirs(tmp_path):
    _cache_file(tmp_path / "fxgraph" / "ab" / "old", 200)
    _cache_file(tmp_path / "new" / "kernel.so", 1)
    _cache_file(tmp_path / "read" / "kernel.so", 200, read_days_ago=1)
    _cache_file(tmp_path / "mixed" / "a.so", 200)
    _cache_file(tmp_path / "mixed" / "b.json", 1)

    result = cache_management_service.evict_stale_compile_cache(
        tmp_path, max_age_days=90
    )

    assert result == {"removed": 1, "freed_bytes": 10}
    assert sorted(p.name for p in tmp_path.iterdir()) == ["mixed", "new", "read"]


def test_compile_cache_dry_run_deletes_nothing(tmp_path):
    _cache_file(tmp_path / "old" / "kernel.so", 200)

    result = cache_management_service.evict_stale_compile_cache(
        tmp_path, max_age_days=90, dry_run=True
    )

    assert result == {"removed": 1, "freed_bytes": 10}
    assert (tmp_path / "old" / "kernel.so").exists()


def test_compile_cache_deletes_stay_inside_a_dir_swapped_mid_walk(
    monkeypatch, tmp_path
):
    """A user swaps a cache directory for a symlink after the walk lists it.

    Deleting by path would follow the symlink and remove the outside file as the
    service account; deletes through the directory handle stay in the original.
    """
    cache, outside = tmp_path / "cache", tmp_path / "outside"
    _cache_file(cache / "bait" / "kernel.so", 200)
    _cache_file(outside / "kernel.so", 200)
    real_stat = os.stat
    swapped = []

    def swapping_stat(path, *args, **kwargs):
        # Swap just before the file's age is checked, however the code stats it:
        # by full path (the old os.walk code) or relative to a directory handle.
        if not swapped and str(path).endswith("kernel.so"):
            swapped.append(True)
            (cache / "bait").rename(cache / "moved")
            (cache / "bait").symlink_to(outside, target_is_directory=True)
        return real_stat(path, *args, **kwargs)

    monkeypatch.setattr(os, "stat", swapping_stat)

    cache_management_service.evict_stale_compile_cache(cache, max_age_days=90)

    assert swapped  # the attack was actually staged
    assert (outside / "kernel.so").exists()
    assert not (cache / "moved" / "kernel.so").exists()


def test_eviction_interval_must_be_positive():
    # 0 would rescan the cache back to back for as long as the backend runs.
    with pytest.raises(ValidationError, match="MODEL_EVICTION_INTERVAL"):
        Settings(MODEL_EVICTION_INTERVAL=0)


def test_run_eviction_refuses_a_zero_day_window(monkeypatch, tmp_path):
    # 0 days would make every model look unused and empty the whole cache.
    monkeypatch.setattr(settings, "MODEL_CACHE_DIR", str(tmp_path))
    with pytest.raises(RuntimeError, match="at least 1"):
        cache_management_service.run_eviction(0, dry_run=True)


# --- background service ---


def test_eviction_is_due_on_startup():
    """The timer is in memory, so frequent restarts must not keep resetting it."""
    service = background_service.BackgroundService()

    elapsed = (datetime.utcnow() - service.last_model_eviction).total_seconds()
    assert elapsed >= service.model_eviction_interval


@pytest.mark.asyncio
async def test_eviction_does_not_start_while_one_is_running(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(
        background_service,
        "run_eviction",
        lambda max_age_days, dry_run: calls.append((max_age_days, dry_run)),
    )
    monkeypatch.setattr(settings, "MODEL_CACHE_DIR", str(tmp_path))
    service = background_service.BackgroundService()

    service._start_model_eviction()
    first = service.eviction_task
    service._start_model_eviction()  # first one hasn't finished yet
    await first

    assert service.eviction_task is first
    assert calls == [
        (settings.MODEL_EVICTION_MAX_AGE_DAYS, settings.MODEL_EVICTION_DRY_RUN)
    ]
