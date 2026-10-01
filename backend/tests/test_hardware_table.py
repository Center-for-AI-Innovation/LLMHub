"""Per-cluster hardware tables: lookup, loading, and the gate on mixed partitions."""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from app.services.fit_estimator.estimator import estimate_fit
from app.services.fit_estimator.hardware import (
    GpuPartition,
    find_partition,
    load_partitions,
    parse_partitions,
)
from app.services.fit_estimator.launch_gate import check_launch_memory_gate
from app.services.fit_estimator.model_metadata import (
    WEIGHTS_FROM_INDEX,
    map_config,
    with_weights,
)
from app.services.fit_estimator.validator import (
    ConfigValidation,
    _empty_breakdown,
    validate_config,
)

INFRA_DIR = Path(__file__).resolve().parents[1] / "config" / "infrastructures"

QWEN_7B_CONFIG = {
    "num_hidden_layers": 28,
    "hidden_size": 3584,
    "num_attention_heads": 28,
    "num_key_value_heads": 4,
    "max_position_embeddings": 32768,
    "torch_dtype": "bfloat16",
}


def _qwen_7b_meta(quantization_config=None):
    config = dict(QWEN_7B_CONFIG)
    if quantization_config:
        config["quantization_config"] = quantization_config
    return with_weights(
        map_config(config, "Qwen/Qwen2.5-7B-Instruct"),
        15_231_233_024,
        WEIGHTS_FROM_INDEX,
    )


def _row(partition, resource_type=None, vram=40.0, **extra) -> GpuPartition:
    return GpuPartition(
        partition=partition,
        gpu_type=f"NVIDIA {resource_type or 'GPU'}",
        vendor="NVIDIA",
        vram_gib_per_gpu=vram,
        framework_overhead_gib=0.8,
        resource_type=resource_type,
        **extra,
    )


MIXED = (
    _row("secondary", "A100", 40.0, compute_capability=8.0),
    _row("secondary", "H100", 79.0, compute_capability=9.0),
    _row("gpuA40x4", "nvidia_a40", 44.988, gpus_per_node=4),
)


@pytest.fixture()
def mixed_table(monkeypatch):
    monkeypatch.setattr(
        "app.services.fit_estimator.launch_gate.load_partitions", lambda: MIXED
    )
    monkeypatch.setattr(
        "app.services.fit_estimator.validator.load_partitions", lambda: MIXED
    )
    monkeypatch.setattr(
        "app.services.fit_estimator.launch_gate._default_resource_type", lambda: None
    )


# --- lookup ----------------------------------------------------------------


def test_find_partition_matches_resource_type_case_insensitively():
    row, error = find_partition("secondary", "h100", MIXED)
    assert error is None
    assert row.vram_gib_per_gpu == 79.0


def test_find_partition_single_type_partition_ignores_resource_type():
    """Delta requests may send legacy names like "A40"; a one-GPU partition
    lands on its only GPU whatever the request calls it."""
    for resource_type in (None, "A40", "nvidia_a40"):
        row, _ = find_partition("gpuA40x4", resource_type, MIXED)
        assert row is not None and row.vram_gib_per_gpu == 44.988


def test_find_partition_mixed_partition_needs_a_known_resource_type():
    row, error = find_partition("secondary", None, MIXED)
    assert row is None and "names none" in error
    row, error = find_partition("secondary", "V100", MIXED)
    assert row is None and "no GPU type 'V100'" in error


def test_find_partition_unknown_partition():
    row, error = find_partition("gpuNope", "A100", MIXED)
    assert row is None and "not in the hardware table" in error


def test_parse_rejects_mixed_partition_rows_without_distinct_resource_types():
    with pytest.raises(ValueError, match="distinct resource_type"):
        parse_partitions(
            {
                "partitions": [
                    {"partition": "p", "gpu_type": "A", "vram_gib_per_gpu": 40},
                    {"partition": "p", "gpu_type": "B", "vram_gib_per_gpu": 80},
                ]
            }
        )
    with pytest.raises(ValueError, match="distinct resource_type"):
        parse_partitions(
            {
                "partitions": [
                    {
                        "partition": "p",
                        "gpu_type": "A",
                        "resource_type": "H100",
                        "vram_gib_per_gpu": 79,
                    },
                    {
                        "partition": "p",
                        "gpu_type": "B",
                        "resource_type": "h100",
                        "vram_gib_per_gpu": 79,
                    },
                ]
            }
        )


# --- loading ---------------------------------------------------------------


@pytest.mark.parametrize("infra", ["delta", "delta-ai-ncsa", "campus-cluster"])
def test_repo_tables_parse(infra):
    rows = parse_partitions(
        yaml.safe_load((INFRA_DIR / infra / "hardware.yaml").read_text())
    )
    assert rows
    assert all(r.vram_gib_per_gpu > 0 for r in rows)


def test_campus_cluster_table_has_no_billing():
    rows = parse_partitions(
        yaml.safe_load((INFRA_DIR / "campus-cluster" / "hardware.yaml").read_text())
    )
    assert all(r.su_per_gpu_hour is None for r in rows)


def test_table_follows_vec_inf_config_dir(tmp_path, monkeypatch):
    """The kit points VEC_INF_CONFIG_DIR at the config it renders; the table
    next to that environment.yaml is the one this process uses."""
    (tmp_path / "hardware.yaml").write_text(
        "partitions:\n"
        "  - partition: ghx4\n"
        "    gpu_type: NVIDIA GH200\n"
        "    vram_gib_per_gpu: 95.0\n"
    )
    monkeypatch.setattr("app.config.config.settings.FIT_ESTIMATOR_HARDWARE_YAML", None)
    monkeypatch.setattr("app.config.config.settings.VEC_INF_CONFIG_DIR", str(tmp_path))
    load_partitions.cache_clear()
    assert [p.partition for p in load_partitions()] == ["ghx4"]


def test_missing_table_means_no_rows(tmp_path, monkeypatch):
    monkeypatch.setattr("app.config.config.settings.FIT_ESTIMATOR_HARDWARE_YAML", None)
    monkeypatch.setattr("app.config.config.settings.VEC_INF_CONFIG_DIR", str(tmp_path))
    load_partitions.cache_clear()
    assert load_partitions() == ()


def test_unreadable_override_fails_loudly(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "app.config.config.settings.FIT_ESTIMATOR_HARDWARE_YAML",
        str(tmp_path / "missing.yaml"),
    )
    load_partitions.cache_clear()
    with pytest.raises(FileNotFoundError):
        load_partitions()


# --- gate and validator on a mixed partition --------------------------------


def _validator_spy(monkeypatch):
    seen = {}

    def _spy(*_a, **kwargs):
        seen.update(kwargs)
        return ConfigValidation(True, None, _empty_breakdown())

    monkeypatch.setattr(
        "app.services.fit_estimator.launch_gate.validate_config_for_model", _spy
    )
    return seen


CATALOG = {"gpus_per_node": 1, "vllm_args": {"--max-model-len": 4096}}


def test_gate_skips_mixed_partition_without_resource_type(mixed_table, monkeypatch):
    seen = _validator_spy(monkeypatch)
    result = check_launch_memory_gate(
        "Qwen2.5-7B-Instruct",
        CATALOG,
        hf_model="Qwen/Qwen2.5-7B-Instruct",
        partition="secondary",
    )
    assert result is None
    assert seen == {}


def test_gate_sizes_the_named_gpu_on_a_mixed_partition(mixed_table, monkeypatch):
    seen = _validator_spy(monkeypatch)
    check_launch_memory_gate(
        "Qwen2.5-7B-Instruct",
        CATALOG,
        hf_model="Qwen/Qwen2.5-7B-Instruct",
        partition="secondary",
        resource_type="H100",
    )
    assert seen["partition"] == "secondary"
    assert seen["resource_type"] == "H100"


def test_gate_does_not_cap_tp_when_node_width_is_unknown(mixed_table, monkeypatch):
    """Campus Cluster rows leave gpus_per_node out; a TP=8 request must not
    be refused against an invented width."""
    seen = _validator_spy(monkeypatch)
    result = check_launch_memory_gate(
        "Qwen2.5-7B-Instruct",
        CATALOG,
        hf_model="Qwen/Qwen2.5-7B-Instruct",
        partition="secondary",
        resource_type="A100",
        tensor_parallel_size=8,
    )
    assert result is not None and result.valid
    assert seen["tensor_parallel_size"] == 8


def test_validator_uses_the_named_gpus_vram():
    meta = _qwen_7b_meta()
    on_a100 = validate_config(
        meta,
        max_model_len=4096,
        tensor_parallel_size=1,
        partition="secondary",
        resource_type="A100",
        partitions=MIXED,
        max_num_seqs=1,
    )
    on_h100 = validate_config(
        meta,
        max_model_len=4096,
        tensor_parallel_size=1,
        partition="secondary",
        resource_type="H100",
        partitions=MIXED,
        max_num_seqs=1,
    )
    assert on_a100.per_gpu_breakdown.vram_gib == 40.0
    assert on_h100.per_gpu_breakdown.vram_gib == 79.0


def test_fp8_checkpoint_refused_below_ada_but_sized_on_hopper():
    meta = _qwen_7b_meta({"quant_method": "fp8"})
    kwargs = dict(
        max_model_len=4096,
        tensor_parallel_size=1,
        partition="secondary",
        partitions=MIXED,
        max_num_seqs=1,
    )
    on_a100 = validate_config(meta, resource_type="A100", **kwargs)
    on_h100 = validate_config(meta, resource_type="H100", **kwargs)
    assert on_a100.unverifiable and "dequantized" in on_a100.reason
    assert not on_h100.unverifiable


# --- survey ----------------------------------------------------------------


def test_survey_lists_each_gpu_of_a_mixed_partition_without_invented_cost():
    est = estimate_fit(
        _qwen_7b_meta(),
        max_model_len=4096,
        tensor_parallel_size=1,
        duration_hours=1.0,
        partitions=MIXED,
    )
    secondary = {
        p.resource_type: p for p in est.partitions if p.partition == "secondary"
    }
    assert set(secondary) == {"A100", "H100"}
    assert all(p.su_per_gpu_hour is None for p in secondary.values())
    assert all(p.estimated_job_su is None for p in secondary.values())


def test_survey_skips_rows_narrower_than_the_requested_tp():
    est = estimate_fit(
        _qwen_7b_meta(),
        max_model_len=4096,
        tensor_parallel_size=8,
        partitions=MIXED,
    )
    a40 = next(p for p in est.partitions if p.partition == "gpuA40x4")
    assert a40.supported is False
    assert "exceeds 4 GPUs per node" in a40.skipped_reason
