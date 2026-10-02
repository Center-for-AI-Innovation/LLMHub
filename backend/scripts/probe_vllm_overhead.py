#!/usr/bin/env python3
"""Measure vLLM's startup memory on a Slurm GPU node, for the fit estimator.

The fit estimator predicts the KV pool vLLM will have as
``VRAM*util - weights - internal overhead``. The overhead term can't be
derived, so it is fitted to real startups (see
``tests/fixtures/vllm_calibration_probes.json``). It changes with the vLLM
version, so every image a cluster runs needs its own probes.

``submit`` writes and submits ONE job that starts ``vllm serve`` several times
in a row inside the same allocation, once per ``TP:MAX_NUM_SEQS`` pair, waits
for each to finish booting, and stops it. ``parse`` reads the logs back into
fixture-format JSON. Weights must already be in the HF cache; the job runs
offline, like a real launch.

    probe_vllm_overhead.py submit --image /sw/llmhub/vllm.sif \\
        --partition gpuA40x4 --gres-type nvidia_a40 --gpus 4 \\
        --account bfmz-delta-gpu --runs 1:32,1:256,1:1024,2:1024,4:1024 \\
        --out /projects/.../probes/a40-v0.19.1
    probe_vllm_overhead.py parse /projects/.../probes/a40-v0.19.1

Standard library only, Python 3.8+: it runs on login nodes and service VMs
whose system Python is old and has no backend venv.
"""

import argparse
import json
import os
import re
import shlex
import subprocess
import sys
from pathlib import Path

JOB_TEMPLATE = """#!/bin/bash
#SBATCH --job-name=vllm-overhead-probe
#SBATCH --partition={partition}
#SBATCH --account={account}
#SBATCH --nodes=1
#SBATCH --gres=gpu:{gres_type}:{gpus}
#SBATCH --cpus-per-task=16
#SBATCH --mem=64G
#SBATCH --time={time}
#SBATCH --output={out}/job.%j.out
#SBATCH --error={out}/job.%j.err

{load_cmd}
set -u
OUT={out}
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits > "$OUT/gpus.csv"
export APPTAINER_BINDPATH="${{APPTAINER_BINDPATH:-}},/dev,/tmp,{hf_cache}:/root/.cache/huggingface"
ENVS="HF_HOME=/root/.cache/huggingface,HF_HUB_CACHE=/root/.cache/huggingface,HF_HUB_OFFLINE=1,TRANSFORMERS_OFFLINE=1,FI_LOG_PROV=none,TORCHINDUCTOR_CACHE_DIR=/tmp/torchinductor-$SLURM_JOB_ID"
PORT=$((20000 + SLURM_JOB_ID % 20000))

for RUN in {runs}; do
    TP=${{RUN%%:*}}; MNS=${{RUN##*:}}
    LOG="$OUT/run.tp${{TP}}.mns${{MNS}}.log"
    echo "=== tp=$TP mns=$MNS $(date -Is)" >&2
    apptainer exec --nv --containall --env "$ENVS" {image} \\
        vllm serve {model} --host 127.0.0.1 --port "$PORT" \\
            --max-model-len {max_model_len} \\
            --tensor-parallel-size "$TP" --max-num-seqs "$MNS" > "$LOG" 2>&1 &
    PID=$!
    for _ in $(seq 1 {boot_timeout}); do
        grep -q "Application startup complete" "$LOG" && break
        kill -0 "$PID" 2>/dev/null || break
        sleep 1
    done
    kill "$PID" 2>/dev/null; wait "$PID" 2>/dev/null
    sleep 10  # let the GPUs release their memory before the next start
    PORT=$((PORT + 1))
done
"""

_ENGINE_VERSION = re.compile(r"LLM engine \(v([^)]+)\)")
_WEIGHTS = re.compile(r"Model loading took ([0-9.]+) GiB")
_KV = re.compile(r"Available KV cache memory: ([0-9.]+) GiB")
_FREE = re.compile(
    r"Free memory on device \(([0-9.]+)/([0-9.]+) GiB\).*?"
    r"Desired GPU memory utilization is \(([0-9.]+)"
)
_RUN_NAME = re.compile(r"run\.tp(\d+)\.mns(\d+)\.log$")


def cmd_submit(args):
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    runs = [r.strip() for r in args.runs.split(",") if r.strip()]
    for run in runs:
        tp, _, mns = run.partition(":")
        if not (tp.isdigit() and mns.isdigit()) or int(tp) > args.gpus:
            sys.exit(f"bad run {run!r}: want TP:MAX_NUM_SEQS with TP <= --gpus")
    script = JOB_TEMPLATE.format(
        partition=args.partition,
        account=args.account,
        gres_type=args.gres_type,
        gpus=args.gpus,
        time=args.time,
        out=shlex.quote(str(out)),
        load_cmd=args.load_cmd or "",
        hf_cache=args.hf_cache,
        runs=" ".join(runs),
        image=shlex.quote(args.image),
        model=shlex.quote(args.model),
        max_model_len=args.max_model_len,
        boot_timeout=args.boot_timeout,
    )
    meta = {
        "image": args.image,
        "model": args.model,
        "partition": args.partition,
        "gres_type": args.gres_type,
        "max_model_len": args.max_model_len,
        "runs": runs,
    }
    (out / "probe.json").write_text(json.dumps(meta, indent=1) + "\n")
    job = out / "probe.sbatch"
    job.write_text(script)
    if args.dry_run:
        print(script)
        return
    result = subprocess.run(
        ["sbatch", "--parsable", str(job)], capture_output=True, text=True
    )
    if result.returncode != 0:
        sys.exit(result.stderr.strip())
    print(f"submitted job {result.stdout.strip()}; logs in {out}")


def _parse_run(log_text):
    kv = [float(v) for v in _KV.findall(log_text)]
    weights = [float(v) for v in _WEIGHTS.findall(log_text)]
    free = _FREE.search(log_text)
    version = _ENGINE_VERSION.search(log_text)
    return {
        "booted": "Application startup complete" in log_text,
        "vllm_version": version.group(1) if version else None,
        # Every TP rank logs its own figures; the smallest is the binding one.
        "weights_per_gpu_gib": max(weights) if weights else None,
        "available_kv_gib": min(kv) if kv else None,
        "vram_gib_vllm": float(free.group(2)) if free else None,
        "gpu_memory_utilization": float(free.group(3)) if free else None,
    }


def cmd_parse(args):
    out = Path(args.dir)
    meta = json.loads((out / "probe.json").read_text())
    gpu_name, vram_smi = None, None
    gpus_csv = out / "gpus.csv"
    if gpus_csv.exists():
        first = gpus_csv.read_text().splitlines()[0]
        gpu_name, mib = [part.strip() for part in first.split(",")]
        vram_smi = round(float(mib) / 1024, 3)
    runs = []
    for log in sorted(out.glob("run.tp*.mns*.log")):
        match = _RUN_NAME.search(log.name)
        tp, mns = int(match.group(1)), int(match.group(2))
        parsed = _parse_run(log.read_text(errors="replace"))
        runs.append(
            {
                "tag": f"{out.name}_tp{tp}_mns{mns}",
                "model": meta["model"],
                "gpu": gpu_name,
                "vram_gib": parsed.pop("vram_gib_vllm") or vram_smi,
                "tp": tp,
                "max_num_seqs": mns,
                "image": os.path.basename(meta["image"]),
                **parsed,
            }
        )
    json.dump({"runs": runs}, sys.stdout, indent=1)
    print()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)

    submit = sub.add_parser("submit", help="write and sbatch one probe job")
    submit.add_argument("--image", required=True, help="vLLM .sif to probe")
    submit.add_argument("--partition", required=True)
    submit.add_argument("--gres-type", required=True, help="e.g. nvidia_a40")
    submit.add_argument("--gpus", type=int, required=True, help="GPUs to allocate")
    submit.add_argument("--account", required=True)
    submit.add_argument("--runs", required=True, help="TP:MNS pairs, e.g. 1:32,4:1024")
    submit.add_argument("--out", required=True, help="directory for script and logs")
    submit.add_argument("--model", default="Qwen/Qwen2.5-7B-Instruct")
    submit.add_argument("--max-model-len", type=int, default=32768)
    submit.add_argument("--hf-cache", default="/projects/modelcache/public/huggingface")
    submit.add_argument("--time", default="00:45:00")
    submit.add_argument("--boot-timeout", type=int, default=600, help="seconds")
    submit.add_argument(
        "--load-cmd", help="shell line run first, e.g. DeltaAI's SLURM_NETWORK"
    )
    submit.add_argument("--dry-run", action="store_true", help="print, don't submit")
    submit.set_defaults(func=cmd_submit)

    parse = sub.add_parser("parse", help="read a probe directory into fixture JSON")
    parse.add_argument("dir")
    parse.set_defaults(func=cmd_parse)

    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
