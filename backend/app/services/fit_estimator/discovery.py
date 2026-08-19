"""Generate a fit-estimator hardware table from a live Slurm cluster.

Portability path for non-Delta HPC sites: instead of hand-maintaining
``delta_hardware.yaml``, run

    python -m app.services.fit_estimator.discovery --output hardware.yaml

on a login node. It reads partitions, GPU GRES names/counts, and walltimes from
``sinfo``, resolves per-GPU VRAM, and writes a YAML file in the exact schema
:mod:`.hardware` loads. Point ``FIT_ESTIMATOR_HARDWARE_YAML`` at the file and
the whole estimator (survey + launch gate) runs against the new cluster.

Per-GPU VRAM resolution, in order of preference:

1. ``--probe``: submit a tiny ``srun`` per distinct GPU type that reads
   ``nvidia-smi memory.total`` on a real node — the measured truth (uses a few
   seconds of GPU allocation per type).
2. A bundled table of measured/conservative values by GRES name. Where a GRES
   name is ambiguous about the memory variant (e.g. bare ``a100`` = 40G or
   80G), the table deliberately assumes the SMALLEST variant: under-stating
   VRAM makes the gate falsely reject, never falsely accept.

What deliberately does NOT transfer automatically:

* SU / billing rates — site-specific policy; edit the generated YAML by hand
  (``su_per_gpu_hour`` per row). Without them the estimator simply omits cost
  figures.
* The internal-overhead calibration (``0.8 + 0.002 x max_num_seqs``) — that is
  a property of the vLLM version, not of the GPU, so it carries over as-is;
  re-probe if the site runs a different vLLM (see calibration fixtures).
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from dataclasses import dataclass

# GRES-name -> (vram_gib, vendor, human label). Substring match on the
# lower-cased GRES name; FIRST match wins, so more specific names sort first.
# Measured values come from nvidia-smi memory.total on real nodes; the rest are
# padded BELOW the typical reported value (conservative: a smaller budget can
# only produce false rejects). Ambiguous names assume the smallest variant.
KNOWN_GPU_VRAM_GIB: tuple[tuple[str, float, str, str], ...] = (
    ("a100_80", 79.2, "NVIDIA", "A100 80GB (typical smi ~79.6 GiB, padded)"),
    ("a100-80", 79.2, "NVIDIA", "A100 80GB (typical smi ~79.6 GiB, padded)"),
    ("a100", 40.0, "NVIDIA", "A100 (assumes 40GB variant; 80GB exists)"),
    ("a40", 44.988, "NVIDIA", "A40 (measured on Delta)"),
    # gh200 MUST precede h200: bare substring matching would otherwise budget
    # a GH200's 96GB GPU at the discrete H200's 140 GiB — a false accept.
    ("gh200", 95.0, "NVIDIA", "GH200 96GB GPU (typical smi ~95.6 GiB, padded)"),
    ("h200", 140.0, "NVIDIA", "H200 (educated pad; probe to tighten)"),
    ("h100", 79.0, "NVIDIA", "H100 80GB (typical smi ~79.6 GiB, padded)"),
    ("l40s", 44.5, "NVIDIA", "L40S 48GB (typical smi ~45 GiB, padded)"),
    ("l40", 44.5, "NVIDIA", "L40 48GB (typical smi ~45 GiB, padded)"),
    ("a30", 23.5, "NVIDIA", "A30 24GB (padded)"),
    ("v100", 15.7, "NVIDIA", "V100 (assumes 16GB variant; 32GB exists)"),
    ("mi300", 127.0, "AMD", "MI300 (assumes 128GB MI300A; ROCm, skipped)"),
    ("mi250", 127.0, "AMD", "MI250 (ROCm; estimator skips AMD)"),
    ("mi100", 32.0, "AMD", "MI100 (ROCm; estimator skips AMD)"),
)

_GRES_GPU_RE = re.compile(r"gpu:(?:(?P<name>[^:,(]+):)?(?P<count>\d+)")


@dataclass(frozen=True)
class DiscoveredPartition:
    """One Slurm partition with GPU GRES, as reported by sinfo.

    ``gpus_per_node`` informs de-duplication only; node width itself comes from
    the vec-inf catalog at launch time, not this table. ``heterogeneous`` marks
    partitions mixing multiple GPU types — excluded from the generated table.
    """

    partition: str
    gres_name: str | None
    gpus_per_node: int
    max_walltime: str | None
    heterogeneous: bool = False


def parse_sinfo_output(text: str) -> list[DiscoveredPartition]:
    """Parse ``sinfo -h -o "%R|%G|%l"`` into GPU partitions.

    sinfo repeats a partition once per node-state group; rows de-duplicate to
    the largest GPU count seen. A partition whose rows expose MORE THAN ONE
    distinct GPU type (e.g. a catch-all ``full`` partition mixing A40, A100,
    and H200 nodes) is marked heterogeneous: one VRAM number cannot honestly
    describe it, so the table builder skips it rather than budgeting the
    whole partition at whichever GPU a row-ordering accident picked.
    Partitions without a ``gpu:`` GRES are skipped (CPU partitions).
    """
    seen: dict[str, DiscoveredPartition] = {}
    names_seen: dict[str, set[str]] = {}
    for line in text.splitlines():
        parts = line.strip().split("|")
        if len(parts) < 3:
            continue
        partition, gres, walltime = (
            parts[0].strip(),
            parts[1].strip(),
            parts[2].strip(),
        )
        if not partition:
            continue
        match = _GRES_GPU_RE.search(gres)
        if not match:
            continue
        name = match.group("name")
        count = int(match.group("count"))
        if count < 1:
            continue
        walltime_value = walltime if walltime and walltime != "infinite" else None
        names_seen.setdefault(partition, set()).add(name.lower() if name else "?")
        existing = seen.get(partition)
        if existing is None or count > existing.gpus_per_node:
            seen[partition] = DiscoveredPartition(
                partition=partition,
                gres_name=name.lower() if name else None,
                gpus_per_node=count,
                max_walltime=walltime_value,
            )
    return [
        (
            part
            if len(names_seen[part.partition]) == 1
            else DiscoveredPartition(
                partition=part.partition,
                gres_name=None,
                gpus_per_node=part.gpus_per_node,
                max_walltime=part.max_walltime,
                heterogeneous=True,
            )
        )
        for part in seen.values()
    ]


def lookup_gpu(
    gres_name: str | None,
) -> tuple[float, str, str] | None:
    """Resolve (vram_gib, vendor, provenance label) for a GRES name."""
    if not gres_name:
        return None
    lowered = gres_name.lower()
    for needle, vram, vendor, label in KNOWN_GPU_VRAM_GIB:
        if needle in lowered:
            return vram, vendor, label
    return None


def run_sinfo() -> str:
    """Invoke sinfo for partition/GRES/walltime columns."""
    result = subprocess.run(
        ["sinfo", "-h", "-o", "%R|%G|%l"],
        capture_output=True,
        text=True,
        timeout=30,
        check=True,
    )
    return result.stdout


def probe_vram_gib(
    partition: str, account: str | None, timeout_s: int = 180
) -> float | None:
    """Measure per-GPU VRAM on a real node via a tiny srun (GPU seconds cost).

    Returns the nvidia-smi ``memory.total`` in GiB, floored to 2 decimals (the
    conservative direction). None on any failure — the caller falls back to the
    bundled table or excludes the partition.
    """
    cmd = [
        "srun",
        f"--partition={partition}",
        "--gres=gpu:1",
        "--time=00:02:00",
        "--quiet",
    ]
    if account:
        cmd.append(f"--account={account}")
    cmd += [
        "nvidia-smi",
        "--query-gpu=memory.total",
        "--format=csv,noheader,nounits",
    ]
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout_s, check=True
        )
        mib = float(result.stdout.strip().splitlines()[0])
    except Exception:
        return None
    import math

    return math.floor((mib / 1024) * 100) / 100


def build_hardware_table(
    partitions: list[DiscoveredPartition],
    *,
    probed_vram: dict[str, float] | None = None,
) -> tuple[dict, list[str]]:
    """Build the hardware-table structure plus a list of skipped partitions.

    ``probed_vram`` maps partition name -> measured VRAM GiB and takes
    precedence over the bundled table. Partitions whose GPU cannot be resolved
    are excluded (never guessed) and reported in the second return value.
    """
    rows: list[dict] = []
    skipped: list[str] = []
    for part in sorted(partitions, key=lambda p: p.partition):
        probed = (probed_vram or {}).get(part.partition)
        looked_up = lookup_gpu(part.gres_name)
        if probed is not None:
            vendor = looked_up[1] if looked_up else "NVIDIA"
            vram = probed
            label = "probed via nvidia-smi on a live node"
        elif looked_up is not None:
            vram, vendor, label = looked_up
        else:
            reason = (
                "mixes multiple GPU types; split it or add rows by hand"
                if part.heterogeneous
                else (
                    f"unrecognized GRES {part.gres_name!r}; probe it or add "
                    f"the value by hand"
                    if part.gres_name
                    else "no GPU type in GRES; probe it or add the value by hand"
                )
            )
            skipped.append(f"{part.partition} ({reason})")
            continue
        row: dict = {
            "partition": part.partition,
            "gpu_type": (part.gres_name or "unknown").upper(),
            "vendor": vendor,
            "vram_gib_per_gpu": vram,
            # Calibrated against vLLM (version-dependent, GPU-independent);
            # see constants.OVERHEAD_BASE_GIB / DEFAULT_TP_COMM_BUFFER_GIB.
            "framework_overhead_gib": 0.8,
            "tp_communication_buffer_gib": 0.25,
            # Site billing is not discoverable; fill in by hand to get SU
            # figures in the UI (omitted -> cost display is simply absent).
            "_vram_provenance": label,
        }
        if part.max_walltime:
            row["max_walltime"] = part.max_walltime
        rows.append(row)
    return {"partitions": rows}, skipped


def render_yaml(table: dict, cluster_note: str) -> str:
    """Serialize the table with a provenance header comment."""
    import yaml

    body = yaml.safe_dump(table, sort_keys=False, default_flow_style=False)
    header = (
        "# Fit-estimator hardware table generated by\n"
        "#   python -m app.services.fit_estimator.discovery\n"
        f"# {cluster_note}\n"
        "#\n"
        "# Review before use:\n"
        "# - vram_gib_per_gpu: _vram_provenance says where each value came\n"
        "#   from; run with --probe (or nvidia-smi on a node) to measure.\n"
        "# - su_per_gpu_hour: add per row if the site bills service units.\n"
        "# - Overhead constants are vLLM-version calibration, not hardware;\n"
        "#   see fit_estimator/constants.py before changing them.\n"
        "#\n"
        "# Activate with FIT_ESTIMATOR_HARDWARE_YAML=/path/to/this/file\n"
    )
    return header + body


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Generate a fit-estimator hardware YAML from Slurm."
    )
    parser.add_argument("--output", required=True, help="Path to write the YAML")
    parser.add_argument(
        "--probe",
        action="store_true",
        help="Measure VRAM with a tiny srun per partition (costs GPU seconds)",
    )
    parser.add_argument("--account", help="Slurm account for --probe jobs")
    args = parser.parse_args(argv)

    try:
        sinfo_text = run_sinfo()
    except FileNotFoundError:
        print("sinfo not found: run this on a Slurm login node.", file=sys.stderr)
        return 1
    partitions = parse_sinfo_output(sinfo_text)
    if not partitions:
        print("No GPU partitions found in sinfo output.", file=sys.stderr)
        return 1

    probed: dict[str, float] = {}
    if args.probe:
        # One srun per DISTINCT GPU type (not per partition): partitions
        # sharing a GPU share the measurement, so the GPU-seconds cost stays
        # proportional to the number of GPU models, not queue permutations.
        by_type: dict[str, list] = {}
        for part in partitions:
            if part.gres_name:
                by_type.setdefault(part.gres_name, []).append(part)
        for gres_name, parts_for_type in by_type.items():
            probe_on = parts_for_type[0]
            print(
                f"probing {gres_name} via {probe_on.partition} ...",
                file=sys.stderr,
            )
            vram = probe_vram_gib(probe_on.partition, args.account)
            if vram is not None:
                for part in parts_for_type:
                    probed[part.partition] = vram
            else:
                print(f"  probe failed for {gres_name}", file=sys.stderr)

    table, skipped = build_hardware_table(partitions, probed_vram=probed)
    if not table["partitions"]:
        print("Every partition was skipped; nothing to write:", file=sys.stderr)
        for entry in skipped:
            print(f"  {entry}", file=sys.stderr)
        return 1
    import socket

    note = f"Discovered from sinfo on {socket.gethostname()}"
    with open(args.output, "w") as fh:
        fh.write(render_yaml(table, note))

    print(f"Wrote {len(table['partitions'])} partitions to {args.output}")
    for entry in skipped:
        print(f"skipped: {entry}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
