# Concurrency / KV consistency findings (Phase 1)

Investigation date: 2026-07-08. Branch: `feat/gpu-fit-estimator`.

## Executive summary

Three different concurrency values were in play across LLMHub surfaces, with no single resolver. The launch **gate** certified `max_model_len × 1`, the **UI fit banner** certified `max_model_len × user_concurrency` (defaulting to a hardcoded **16**), and the **actual vLLM job** ran at catalog `vllm_args` or vLLM default **256** (90/94 models). This produced:

- **False-accept (safety)**: gate passes → job launches at 256 concurrent seqs → runtime KV pool may exhaust under burst load.
- **False-reject (UX)**: banner says “will not run” at concurrency 16 while gate would pass at ×1.
- **Precedence regression**: UI-sent `max_num_seqs=16` overrides curated catalog values (e.g. vision models at 32/64) via vec-inf CLI merge.

**Shipped:** Option B launch gate (boot / `×1`) plus `resolve_max_num_seqs` for catalog/UI/deploy precedence. Option A (gate on effective concurrency) remains a possible follow-up.

---

## 1. Concurrency trace (end to end)

| Surface | Source of `max_num_seqs` | Typical value (Qwen2.5-7B) |
|---------|--------------------------|----------------------------|
| **UI fit banner** | `launch-model-dialog.tsx` → `DEFAULT_MAX_NUM_SEQS = 16` (frontend constant) | **16** (hardcoded) |
| **Fit estimate API** | Request `max_num_seqs` or `DEFAULT_MAX_NUM_SEQS` (256) in `estimator.py` | Whatever UI sends (16) |
| **Launch gate** | `LAUNCH_GATE_MAX_NUM_SEQS = 1` in `launch_gate.py` | **1** (always) |
| **Validator formula** | `worst_case_tokens = max_model_len * max_num_seqs` (`validator.py:206`) | Gate passes **1**; survey API uses **256** default |
| **Deploy payload (old)** | Not sent from frontend | `None` |
| **Deploy payload (new, broken)** | Always sends UI default **16** | **16** |
| **`llm_inference.py`** | Adds `--max-num-seqs=N` only when `params.max_num_seqs is not None` (lines 128–129) | Omitted (old) or **16** (new) |
| **vec-inf merge** | Catalog `vllm_args` dict → `engine_args`; LaunchOptions `vllm_args` **overwrites** same keys (`_helper.py:230–231`) | Catalog if omitted; UI value if sent |
| **`models.yaml` catalog** | Per-model `vllm_args: --max-num-seqs: N` | **Omitted** → vLLM runtime default |
| **vLLM runtime** | `--max-num-seqs` flag or built-in default | **256** when catalog omits flag |

### Catalog inventory (`backend/config/models.yaml`)

- **94** models total.
- **4** models set explicit `--max-num-seqs`:
  - `Llama-3.2-11B-Vision` / `-Instruct`: **64**
  - `Llama-3.2-90B-Vision` / `-Instruct`: **32**
- **90** models omit `--max-num-seqs` → effective runtime concurrency = **vLLM default 256**.

`Qwen2.5-7B-Instruct` catalog entry (`models.yaml:671–681`): only `--max-model-len: 32768`; no `--max-num-seqs`.

---

## 2. Precedence bug (UI vs catalog)

**Confirmed.** vec-inf `_engine_check_override` parses LaunchOptions `vllm_args` and **overwrites** catalog `engine_args` per key:

```python
for key, value in engine_args.items():
    params["engine_args"][key] = value
```

(`vec_inf/client/_helper.py`, lines 230–231)

### Resolved vLLM command line: Llama-3.2-90B-Vision + UI default 16

| Step | `--max-num-seqs` |
|------|------------------|
| Catalog `models.yaml` | **32** |
| LLMHub `llm_inference._build_launch_options(max_num_seqs=16)` | Appends `--max-num-seqs=16` to LaunchOptions |
| vec-inf merged `engine_args` | **16** (catalog 32 **overwritten**) |

**Before the new UI:** deploy omitted `max_num_seqs` → vec-inf used catalog **32** (vision) or vLLM **256** (typical LLM).

---

## 3. Gate vs UI formula mismatch

Both use the same underlying formula when given the same `max_num_seqs`:

```text
worst_case_tokens = max_model_len × max_num_seqs
KV GiB = per_token_kv_bytes_per_gpu × worst_case_tokens
fits = (weights + KV + overhead) ≤ VRAM
```

**Validator** (`validate_config`) and **estimator** (`estimate_fit`, `kv_assumption="worst_case"`) share this model.

They disagree because they pass **different** `max_num_seqs`:

| Path | `max_num_seqs` used |
|------|---------------------|
| Launch gate | `LAUNCH_GATE_MAX_NUM_SEQS` = **1** |
| UI banner / fit-estimate | User value (default **16**) |

### Concrete disagreement: Qwen2.5-7B, ctx=32768, 1 GPU, gpuA40x4

Computed with calibrated Qwen 7B metadata (same as `test_launch_gate.py`):

| Concurrency | Gate / validator `valid` | Estimator `fits` (worst_case) |
|-------------|--------------------------|-------------------------------|
| 1 (gate today) | **True** | True |
| 16 (UI default) | False | **False** |
| 256 (runtime default) | False | False |

**Screenshot case (ctx=32K, conc=16):** gate **passes**, UI banner **“will not run”** — direct mismatch.

With catalog default context 32768 and runtime concurrency 256, gate passes but actual job could OOM under full saturation.

---

## 4. False-accept surface

**Yes — the ×1 gate permits launches that run at higher concurrency and can exhaust KV at runtime.**

Mechanism (documented in `constants.py:18–20`, `launch_gate.py:8–12`):

1. vLLM loads weights + framework overhead at startup.
2. Remaining VRAM under `gpu_memory_utilization=0.9` becomes a **dynamic KV pool** (PagedAttention).
3. vLLM does **not** pre-allocate `max_model_len × max_num_seqs` KV at startup.
4. `--max-num-seqs` caps scheduler concurrency; sequences grow into the pool until OOM or rejection.

The ×1 gate only certifies startup with one full-context sequence worth of **budget math**, not the configured `--max-num-seqs`. A job passing the gate can start successfully, then hit memory pressure when many long concurrent requests arrive.

**No runtime cap prevents OOM** beyond vLLM’s pool size and scheduler limits; there is no LLMHub-side enforcement after launch.

---

## 5. Archetype / typical factors

**Display / survey only — never gate launches.**

| Component | Uses archetype? |
|-----------|-----------------|
| `validate_config` / launch gate | **No** — worst-case only (`validator.py:21–23`) |
| `check_launch_memory_gate` | **No** — passes `max_num_seqs=1` |
| `estimate_fit` primary `fits` | Uses `kv_assumption` from request; UI sends default `worst_case` |
| `both_assumptions.typical` in API response | Computed but **not** used for launch block or UI banner verdict |
| `workload_archetypes.yaml` | Explicitly **PLACEHOLDER / uncalibrated** |

Archetype factors must remain labeled advisory if shown in UI.

---

## 6. Option A vs Option B

### Option A — Certify real concurrency

- Gate, UI, and vLLM command all use `resolve_max_num_seqs(ui_override, catalog) → 256`.
- UI override only when user **explicitly changes** concurrency (preserve catalog 32/64).
- Stricter: Qwen 7B @ 32K context likely **fails gate** at 256 — matches runtime risk.
- Aligns with fail-closed safety posture.

### Option B — Certify boot + advisory burst (**shipped**)

- Gate keeps ×1 “can start”; UI shows burst / capacity estimates separately.
- Launch button soft-blocks on selected-partition startup (`starts`), not on saturated concurrency.
- Leaves a false-accept surface for burst load at high `--max-num-seqs` (documented; intentional).

**Shipped decision: Option B for the launch gate**, with Option A’s concurrency resolver for catalog/UI/deploy precedence. Revisit Option A if production OOMs under concurrency justify a stricter gate.

---

## 7. Phase 2 status

1. **`resolve_max_num_seqs(ui_override, catalog_value)`** — done.
2. **Precedence**: `ui_override` (only when user explicitly set) > catalog > 256 — done.
3. **Regression fix**: UI defaults to catalog-resolved value (256 for most models; 32/64 for vision), not 16 — done.
4. **Gate/UI reconciliation** to the same concurrency for hard `valid` — **not done** (gate stays ×1; UI capacity is advisory).
5. **Archetypes**: display-only, labeled uncalibrated — done.
6. **Tests**: resolver precedence, vision catalog preservation, no silent 256→16 regression — done.
