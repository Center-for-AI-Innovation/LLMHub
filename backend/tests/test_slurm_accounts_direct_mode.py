from app.config.config import settings
from app.controllers import model_controller


def test_direct_mode_returns_env_account_without_sacctmgr(monkeypatch):
    monkeypatch.setattr(settings, "VEC_INF_EXECUTION_MODE", "direct")
    monkeypatch.setattr(settings, "VEC_INF_ACCOUNT", "bgns-delta-gpu")
    monkeypatch.setattr(settings, "SLURM_ACCOUNT", "other")

    def fail_if_called(_username):
        raise AssertionError("direct mode should not call sacctmgr")

    monkeypatch.setattr(model_controller, "list_user_slurm_accounts", fail_if_called)

    result = model_controller.get_slurm_accounts(clusterUsername="alice")
    assert result == {
        "accounts": ["bgns-delta-gpu"],
        "defaultAccount": "bgns-delta-gpu",
    }


def test_direct_mode_falls_back_to_slurm_account(monkeypatch):
    monkeypatch.setattr(settings, "VEC_INF_EXECUTION_MODE", "direct")
    monkeypatch.setattr(settings, "VEC_INF_ACCOUNT", None)
    monkeypatch.setattr(settings, "SLURM_ACCOUNT", "root")

    result = model_controller.get_slurm_accounts(clusterUsername="alice")
    assert result == {"accounts": ["root"], "defaultAccount": "root"}


def test_direct_mode_without_env_account_uses_sacctmgr(monkeypatch):
    monkeypatch.setattr(settings, "VEC_INF_EXECUTION_MODE", "direct")
    monkeypatch.setattr(settings, "VEC_INF_ACCOUNT", "  ")
    monkeypatch.setattr(settings, "SLURM_ACCOUNT", None)
    monkeypatch.setattr(
        model_controller,
        "list_user_slurm_accounts",
        lambda _username: ["proj-delta-gpu"],
    )
    monkeypatch.setattr(
        model_controller, "pick_default_slurm_account", lambda accounts: accounts[0]
    )

    result = model_controller.get_slurm_accounts(clusterUsername="alice")
    assert result == {
        "accounts": ["proj-delta-gpu"],
        "defaultAccount": "proj-delta-gpu",
    }


def test_impersonate_mode_lists_user_accounts(monkeypatch):
    monkeypatch.setattr(settings, "VEC_INF_EXECUTION_MODE", "impersonate")
    monkeypatch.setattr(settings, "VEC_INF_ACCOUNT", "service-acct")
    monkeypatch.setattr(
        model_controller,
        "list_user_slurm_accounts",
        lambda username: (
            ["proj-delta-cpu", "proj-delta-gpu"] if username == "alice" else []
        ),
    )
    monkeypatch.setattr(
        model_controller,
        "pick_default_slurm_account",
        lambda accounts: "proj-delta-gpu",
    )

    result = model_controller.get_slurm_accounts(clusterUsername="alice")
    assert result == {
        "accounts": ["proj-delta-cpu", "proj-delta-gpu"],
        "defaultAccount": "proj-delta-gpu",
    }
