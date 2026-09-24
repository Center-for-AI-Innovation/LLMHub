from types import SimpleNamespace

from app.utils import slurm_accounts


def test_list_user_slurm_accounts_uses_sacctmgr(monkeypatch):
    def fake_run(command, **kwargs):
        assert command == [
            "sacctmgr",
            "-nP",
            "show",
            "associations",
            "user=alice",
            "format=Account",
        ]
        return SimpleNamespace(
            returncode=0,
            stdout="proj-delta-cpu\nproj-delta-gpu\nproj-delta-cpu\n",
            stderr="",
        )

    monkeypatch.setattr(slurm_accounts.subprocess, "run", fake_run)

    assert slurm_accounts.list_user_slurm_accounts("alice") == [
        "proj-delta-cpu",
        "proj-delta-gpu",
    ]


def test_list_user_slurm_accounts_strips_pipe_padding(monkeypatch):
    def fake_run(command, **kwargs):
        return SimpleNamespace(
            returncode=0,
            stdout="bgns-delta-gpu|\n\n",
            stderr="",
        )

    monkeypatch.setattr(slurm_accounts.subprocess, "run", fake_run)

    assert slurm_accounts.list_user_slurm_accounts("alice") == ["bgns-delta-gpu"]


def test_list_user_slurm_accounts_omits_noalloc(monkeypatch):
    def fake_run(command, **kwargs):
        return SimpleNamespace(
            returncode=0,
            stdout="bfmz-delta-gpu\nnoalloc\nbfmz-delta-cpu\n",
            stderr="",
        )

    monkeypatch.setattr(slurm_accounts.subprocess, "run", fake_run)

    assert slurm_accounts.list_user_slurm_accounts("alice") == [
        "bfmz-delta-gpu",
        "bfmz-delta-cpu",
    ]


def test_list_user_slurm_accounts_raises_on_failure(monkeypatch):
    def fake_run(command, **kwargs):
        return SimpleNamespace(returncode=1, stdout="", stderr="sacctmgr: error")

    monkeypatch.setattr(slurm_accounts.subprocess, "run", fake_run)

    try:
        slurm_accounts.list_user_slurm_accounts("alice")
    except RuntimeError as exc:
        assert "Failed to resolve Slurm accounts for alice" in str(exc)
        assert "sacctmgr: error" in str(exc)
    else:
        raise AssertionError("Expected listing failure to raise")


def test_list_user_slurm_accounts_raises_when_sacctmgr_missing(monkeypatch):
    def fake_run(command, **kwargs):
        raise FileNotFoundError("sacctmgr")

    monkeypatch.setattr(slurm_accounts.subprocess, "run", fake_run)

    try:
        slurm_accounts.list_user_slurm_accounts("alice")
    except RuntimeError as exc:
        assert "Required command not found: sacctmgr" in str(exc)
    else:
        raise AssertionError("Expected missing sacctmgr to raise")


def test_pick_default_slurm_account_prefers_gpu():
    assert (
        slurm_accounts.pick_default_slurm_account(["proj-delta-cpu", "proj-delta-gpu"])
        == "proj-delta-gpu"
    )


def test_pick_default_slurm_account_falls_back_to_first():
    assert slurm_accounts.pick_default_slurm_account(["proj-delta-cpu"]) == (
        "proj-delta-cpu"
    )


def test_select_user_slurm_account_prefers_gpu(monkeypatch):
    monkeypatch.setattr(
        slurm_accounts,
        "list_user_slurm_accounts",
        lambda _username: ["proj-delta-cpu", "proj-delta-gpu"],
    )

    assert slurm_accounts.select_user_slurm_account("alice") == "proj-delta-gpu"


def test_select_user_slurm_account_raises_when_empty(monkeypatch):
    monkeypatch.setattr(
        slurm_accounts, "list_user_slurm_accounts", lambda _username: []
    )

    try:
        slurm_accounts.select_user_slurm_account("alice")
    except RuntimeError as exc:
        assert "No Slurm accounts found for alice" in str(exc)
    else:
        raise AssertionError("Expected empty account list to raise")
