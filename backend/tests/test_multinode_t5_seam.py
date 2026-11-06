"""T5: every vec-inf member the multinode adapter uses still exists.

Names only. A vec-inf bump that moves behaviour inside an overridden method is
invisible here; the 2-node hardware launch-test on both clusters is the gate
for that. What this catches is a rename that would silently orphan an override
and send multinode requests back to vec-inf's Ray path.
"""

import inspect

import pytest
import vec_inf.client._helper as helper
import vec_inf.client._slurm_script_generator as generator
import vec_inf.client._slurm_templates as templates
import vec_inf.client._slurm_vars as slurm_vars
import vec_inf.client._utils as utils
import vec_inf.client.api as api
import vec_inf.client.models as models
from multinode_helpers import TWO_NODE_MODEL, Launcher

# (object, attribute) pairs the adapter or its call site reads, calls or overrides.
SEAM = [
    (helper, "ModelLauncher"),
    (helper.ModelLauncher, "__init__"),
    (helper.ModelLauncher, "_build_launch_command"),
    (helper.ModelLauncher, "launch"),
    (generator, "SlurmScriptGenerator"),
    (generator.SlurmScriptGenerator, "_generate_script_content"),
    (generator.SlurmScriptGenerator, "_generate_shebang"),
    (generator.SlurmScriptGenerator, "_generate_server_setup"),
    (generator.SlurmScriptGenerator, "_generate_launch_cmd"),
    (generator.SlurmScriptGenerator, "_generate_env_str"),
    (generator.SlurmScriptGenerator, "write_to_log_dir"),
    (templates, "SLURM_SCRIPT_TEMPLATE"),
    (slurm_vars, "IMAGE_PATH"),
    (models, "LaunchOptions"),
    (models, "LaunchResponse"),
    (api.VecInfClient, "launch_model"),
    (utils, "is_server_running"),
]

TEMPLATE_KEYS = [
    "container_setup",
    "bind_path",
    "imports",
    "container_command",
    "find_server_port",
    "write_to_json",
]

# Set by SlurmScriptGenerator.__init__ and read by the adapter's generator.
GENERATOR_ATTRIBUTES = [
    "params",
    "engine",
    "is_multinode",
    "use_container",
    "additional_binds",
    "model_weights_path",
    "env_str",
]

# Keys of ModelLauncher.params the adapter reads.
PARAM_KEYS = [
    "num_nodes",
    "engine",
    "venv",
    "log_dir",
    "model_name",
    "work_dir",
    "src_dir",
    "engine_args",
    "env",
]


@pytest.mark.parametrize(
    "owner, name", SEAM, ids=[f"{o.__name__}.{n}" for o, n in SEAM]
)
def test_member_exists(owner, name):
    assert hasattr(owner, name), f"vec-inf no longer has {owner.__name__}.{name}"


@pytest.mark.parametrize("key", TEMPLATE_KEYS)
def test_template_key_exists(key):
    assert key in templates.SLURM_SCRIPT_TEMPLATE


def test_vllm_image_path_exists():
    assert "vllm" in slurm_vars.IMAGE_PATH


@pytest.mark.parametrize("field", ["env_str", "image_path"])
def test_container_command_placeholders(field):
    assert "{" + field + "}" in templates.SLURM_SCRIPT_TEMPLATE["container_command"]


@pytest.mark.parametrize("name", GENERATOR_ATTRIBUTES)
def test_generator_sets_attribute(name):
    source = inspect.getsource(generator.SlurmScriptGenerator.__init__)
    assert f"self.{name} =" in source


def test_launch_params_carry_keys(monkeypatch, tmp_path):
    Launcher(monkeypatch, tmp_path)
    params = helper.ModelLauncher(
        TWO_NODE_MODEL,
        {"log_dir": str(tmp_path / "logs"), "work_dir": str(tmp_path), "account": "a"},
    ).params

    assert [key for key in PARAM_KEYS if key not in params] == []


@pytest.mark.parametrize(
    "caller, callee",
    [
        (
            generator.SlurmScriptGenerator._generate_script_content,
            "_generate_server_setup",
        ),
        (
            generator.SlurmScriptGenerator._generate_script_content,
            "_generate_launch_cmd",
        ),
        (generator.SlurmScriptGenerator.write_to_log_dir, "_generate_script_content"),
        (helper.ModelLauncher.launch, "_build_launch_command"),
        (api.VecInfClient.launch_model, "ModelLauncher"),
    ],
)
def test_overridden_members_are_still_called(caller, callee):
    """An override vec-inf stopped calling would never run."""
    assert callee in inspect.getsource(caller)
