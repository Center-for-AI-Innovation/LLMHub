"""Tests for Slurm hardware discovery (pure parsing; no subprocess)."""

from __future__ import annotations

import pytest
import yaml

from app.services.fit_estimator.discovery import (
    build_hardware_table,
    lookup_gpu,
    parse_sinfo_output,
    render_yaml,
)
from app.services.fit_estimator.hardware import (
    HARDWARE_YAML_ENV,
    load_partitions,
    parse_partitions,
)

# Shape captured from `sinfo -h -o "%R|%G|%l"` on Delta: partitions repeat per
# node-state group, CPU partitions have (null) gres, and GRES names vary.
DELTA_SINFO = """\
cpu|(null)|2-00:00:00
gpuA40x4|gpu:nvidia_a40:4(S:0-3)|2-00:00:00
gpuA40x4|gpu:nvidia_a40:4(S:0-3)|2-00:00:00
gpuA100x4|gpu:nvidia_a100:4(S:0-3)|2-00:00:00
gpuA100x8|gpu:nvidia_a100:8(S:1,3,5,7)|2-00:00:00
gpuH200x8|gpu:h200:8(S:0,2)|2-00:00:00
gpuMI100x8|gpu:mi100:8|2-00:00:00
weird|gpu:4|infinite
unknowable|gpu:tpu_v9:4|1:00:00
"""


def test_parse_sinfo_dedupes_and_skips_cpu_partitions() -> None:
    parts = {p.partition: p for p in parse_sinfo_output(DELTA_SINFO)}
    assert "cpu" not in parts
    assert parts["gpuA40x4"].gres_name == "nvidia_a40"
    assert parts["gpuA40x4"].gpus_per_node == 4
    assert parts["gpuA100x8"].gpus_per_node == 8
    assert parts["weird"].gres_name is None  # bare gpu:N
    assert parts["weird"].max_walltime is None  # "infinite" -> unbounded
    assert len([p for p in parts if p == "gpuA40x4"]) == 1


def test_lookup_prefers_specific_names_and_assumes_smallest_variant() -> None:
    assert lookup_gpu("a100_80gb")[0] == pytest.approx(79.2)
    # Bare "a100" must resolve to the 40GB variant: under-stating VRAM can only
    # false-reject, never false-accept.
    assert lookup_gpu("nvidia_a100")[0] == pytest.approx(40.0)
    assert lookup_gpu("nvidia_a40")[0] == pytest.approx(44.988)
    assert lookup_gpu("mi100")[1] == "AMD"
    assert lookup_gpu("tpu_v9") is None
    assert lookup_gpu(None) is None


def test_build_table_excludes_unknown_gpus_never_guesses() -> None:
    parts = parse_sinfo_output(DELTA_SINFO)
    table, skipped = build_hardware_table(parts)
    names = {row["partition"] for row in table["partitions"]}
    assert "gpuA40x4" in names
    assert "gpuMI100x8" in names  # AMD kept: estimator reports it as skipped
    assert "unknowable" not in names
    assert "weird" not in names
    assert any("unknowable" in entry for entry in skipped)


def test_probed_vram_takes_precedence() -> None:
    parts = parse_sinfo_output("gpuA40x4|gpu:nvidia_a40:4|2-00:00:00\n")
    table, _ = build_hardware_table(parts, probed_vram={"gpuA40x4": 44.98})
    row = table["partitions"][0]
    assert row["vram_gib_per_gpu"] == pytest.approx(44.98)
    assert "probed" in row["_vram_provenance"]


def test_generated_yaml_round_trips_through_hardware_loader() -> None:
    parts = parse_sinfo_output(DELTA_SINFO)
    table, _ = build_hardware_table(parts)
    text = render_yaml(table, "test cluster")
    loaded = parse_partitions(yaml.safe_load(text))
    a40 = next(p for p in loaded if p.partition == "gpuA40x4")
    assert a40.vram_gib_per_gpu == pytest.approx(44.988)
    assert a40.is_nvidia
    assert a40.su_per_gpu_hour is None  # site billing is never invented
    mi100 = next(p for p in loaded if p.partition == "gpuMI100x8")
    assert not mi100.is_nvidia


def test_hardware_yaml_env_override(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    parts = parse_sinfo_output("gpuX100x2|gpu:nvidia_a40:2|1:00:00\n")
    table, _ = build_hardware_table(parts)
    path = tmp_path / "site_hardware.yaml"
    path.write_text(render_yaml(table, "test cluster"))

    monkeypatch.setenv(HARDWARE_YAML_ENV, str(path))
    load_partitions.cache_clear()
    try:
        loaded = load_partitions()
        assert [p.partition for p in loaded] == ["gpuX100x2"]
    finally:
        load_partitions.cache_clear()


def test_heterogeneous_partition_is_skipped_never_collapsed() -> None:
    """A catch-all partition mixing GPU types (Delta's `full`) must be skipped:
    budgeting the whole partition at whichever GPU a row-ordering accident
    picked could overstate VRAM by 100 GiB (H200 row winning over A40)."""
    text = (
        "full|gpu:nvidia_a100:8(S:1,3,5,7)|1-00:00:00\n"
        "full|gpu:mi100:8(S:1,3,5,7),gpu:mi210:1(S:5)|1-00:00:00\n"
        "full|gpu:h200:8(S:0,2)|1-00:00:00\n"
        "full|gpu:nvidia_a40:4(S:0-3)|1-00:00:00\n"
    )
    parts = parse_sinfo_output(text)
    assert len(parts) == 1
    assert parts[0].heterogeneous is True
    table, skipped = build_hardware_table(parts)
    assert table["partitions"] == []
    assert any("mixes multiple GPU types" in entry for entry in skipped)


def test_gh200_never_matches_h200_vram() -> None:
    """GH200's 96GB GPU must not inherit the discrete H200's 140 GiB."""
    vram, vendor, _label = lookup_gpu("gh200")
    assert vram == pytest.approx(95.0)
    assert vendor == "NVIDIA"
    assert lookup_gpu("h200")[0] == pytest.approx(140.0)
