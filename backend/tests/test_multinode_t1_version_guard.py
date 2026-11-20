"""T1: the adapter refuses a vec-inf it was not tested against, and fails closed.

On an unknown vec-inf a multinode request is refused before anything is
submitted: it never falls back to vec-inf's own (Ray) multinode path.
Single-node launches are not the adapter's and keep working.
"""

import pytest
from multinode_helpers import ONE_NODE_MODEL, TWO_NODE_MODEL, Launcher

from app.utils import vec_inf_multinode


def test_the_pinned_version_is_the_only_one_accepted():
    assert vec_inf_multinode.SUPPORTED_VEC_INF_VERSIONS == {"0.9.0"}
    vec_inf_multinode.check_vec_inf_version("0.9.0")


@pytest.mark.parametrize("version", ["0.9.1", "0.10.0", "1.0.0", "0.8.9", ""])
def test_other_versions_are_refused(version):
    with pytest.raises(vec_inf_multinode.MultinodeLaunchError, match="refused"):
        vec_inf_multinode.check_vec_inf_version(version)


def test_missing_vec_inf_is_refused(monkeypatch):
    monkeypatch.setattr(vec_inf_multinode, "installed_vec_inf_version", lambda: None)
    with pytest.raises(vec_inf_multinode.MultinodeLaunchError, match="not installed"):
        vec_inf_multinode.check_vec_inf_version()


def test_installed_version_is_read_from_package_metadata():
    assert vec_inf_multinode.installed_vec_inf_version() == "0.9.0"


def test_unknown_version_submits_nothing_for_multinode(monkeypatch, tmp_path):
    launcher = Launcher(monkeypatch, tmp_path)
    monkeypatch.setattr(vec_inf_multinode, "installed_vec_inf_version", lambda: "0.9.1")

    result = launcher.launch(TWO_NODE_MODEL)

    assert result["success"] is False
    assert "vec-inf 0.9.1 is not a version" in result["error"]
    assert launcher.scripts() == [], "a refused launch must not reach sbatch"


def test_launcher_itself_refuses_an_unknown_version(monkeypatch, tmp_path):
    Launcher(monkeypatch, tmp_path)
    monkeypatch.setattr(vec_inf_multinode, "installed_vec_inf_version", lambda: "0.9.1")

    with pytest.raises(vec_inf_multinode.MultinodeLaunchError):
        vec_inf_multinode.MultinodeLauncher(
            TWO_NODE_MODEL,
            {
                "log_dir": str(tmp_path / "logs"),
                "work_dir": str(tmp_path),
                "account": "a",
            },
        )


def test_unknown_version_leaves_single_node_alone(monkeypatch, tmp_path):
    launcher = Launcher(monkeypatch, tmp_path)
    monkeypatch.setattr(vec_inf_multinode, "installed_vec_inf_version", lambda: "0.9.1")

    result = launcher.launch(ONE_NODE_MODEL)

    assert result["success"], result
    (script,) = launcher.scripts()
    assert "llmhub-multinode" not in script
