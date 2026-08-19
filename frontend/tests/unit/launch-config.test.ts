import { describe, expect, it } from 'vitest';

import {
  clampGpuCount,
  formatCapacityVerdict,
  formatSuBreakdown,
  maxGpusForPartition,
  resolvePartitionCapacity,
  resourceTypeForPartition,
  VLLM_DEFAULT_MAX_NUM_SEQS,
} from '@/lib/models/launch-config';

describe('lib/models/launch-config', () => {
  it('uses the vLLM V1-engine default concurrency (1024, not the V0 256)', () => {
    // Verified live on the production Delta container; must stay in sync with
    // the backend's DEFAULT_MAX_NUM_SEQS.
    expect(VLLM_DEFAULT_MAX_NUM_SEQS).toBe(1024);
  });

  it("maps partitions to the cluster's real GRES names", () => {
    // Source of truth: `sinfo -o "%P %G"` on Delta.
    expect(resourceTypeForPartition('gpuA40x4')).toBe('nvidia_a40');
    expect(resourceTypeForPartition('gpuA40x4-preempt')).toBe('nvidia_a40');
    expect(resourceTypeForPartition('gpuA100x4')).toBe('nvidia_a100');
    expect(resourceTypeForPartition('gpuA100x8')).toBe('nvidia_a100');
    expect(resourceTypeForPartition('gpuH200x8')).toBe('h200');
    expect(resourceTypeForPartition('gpuUnknown')).toBe('nvidia_a40');
  });

  it('caps GPU count by the partition node size', () => {
    expect(maxGpusForPartition('gpuA40x4')).toBe(4);
    expect(maxGpusForPartition('gpuA40x4-preempt')).toBe(4);
    expect(maxGpusForPartition('gpuH200x8')).toBe(8);
    expect(clampGpuCount(8, 'gpuA40x4')).toBe(4);
    expect(clampGpuCount(3, 'gpuA40x4')).toBe(2); // nearest allowed below
    expect(clampGpuCount(2, 'gpuA100x8')).toBe(2);
  });

  describe('resolvePartitionCapacity', () => {
    const opts = {
      perTokenKvBytes: 57_344, // Qwen2.5-7B
      maxModelLen: 32_768,
      typicalSeqLen: 4_096,
      maxNumSeqs: 256,
    };

    it('prefers API capacity fields when present', () => {
      const resolved = resolvePartitionCapacity(
        {
          vram_gib: 44.988,
          starts: true,
          kv_pool_tokens: 466_000,
          concurrent_at_full_context: 14,
          concurrent_at_typical: 113,
        },
        opts,
      );
      expect(resolved.starts).toBe(true);
      expect(resolved.concurrentAtFullContext).toBe(14);
    });

    it('derives capacity from the breakdown when API fields are absent', () => {
      const resolved = resolvePartitionCapacity(
        {
          vram_gib: 44.988,
          breakdown: { weights_gib: 14.2488, overhead_gib: 5.8108 },
        },
        opts,
      );
      expect(resolved.starts).toBe(true);
      // pool ≈ 24.93 GiB / 56 KiB per token ≈ 466k tokens
      expect(resolved.kvPoolTokens).toBeGreaterThan(400_000);
      expect(resolved.concurrentAtFullContext).toBeGreaterThan(0);
    });

    it('reports a definite non-start when the pool is non-positive', () => {
      const resolved = resolvePartitionCapacity(
        {
          vram_gib: 40,
          breakdown: { weights_gib: 38, overhead_gib: 5 },
        },
        opts,
      );
      expect(resolved.starts).toBe(false);
      expect(resolved.kvPoolTokens).toBe(0);
    });

    it('stays unknown (never guesses) without per-token KV data', () => {
      const resolved = resolvePartitionCapacity(
        { vram_gib: 44.988 },
        { ...opts, perTokenKvBytes: null },
      );
      expect(resolved.starts).toBeNull();
    });
  });

  describe('formatCapacityVerdict', () => {
    const base = {
      partition: 'gpuA40x4',
      contextLength: 32_768,
      typicalSeqLen: 4_096,
      concurrentAtFullContext: 14,
      concurrentAtTypical: 113,
      kvPoolTokens: 466_000,
    };

    it('blocks with an error tone only on a definite non-start', () => {
      const verdict = formatCapacityVerdict({
        ...base,
        starts: false,
        pending: false,
      });
      expect(verdict.tone).toBe('error');
      expect(verdict.title).toContain("Won't start");
    });

    it('reports success with capacity detail when startup is verified', () => {
      const verdict = formatCapacityVerdict({
        ...base,
        starts: true,
        pending: false,
      });
      expect(verdict.tone).toBe('success');
      expect(verdict.detail).toContain('14 concurrent');
    });

    it('shows pending while the estimate is in flight', () => {
      const verdict = formatCapacityVerdict({
        ...base,
        starts: null,
        pending: true,
      });
      expect(verdict.tone).toBe('pending');
    });

    it('warns without blocking when startup cannot be verified', () => {
      // Mirrors the backend launch gate, which skips (never blocks) configs
      // it cannot size — sparse VLM metadata, gated repos, HF outages.
      const verdict = formatCapacityVerdict({
        ...base,
        starts: null,
        pending: false,
      });
      expect(verdict.tone).toBe('warning');
      expect(verdict.title).toContain("Can't verify");
      expect(verdict.detail).toContain('still launch');
    });
  });

  it('formats an internally consistent SU breakdown', () => {
    expect(formatSuBreakdown(500, 2, 1, 1000)).toBe(
      '1,000 SU/hr (500/GPU × 2) × 1 hr = 1,000 SU',
    );
    expect(formatSuBreakdown(250, 1, 0.25, 63)).toBe(
      '250 SU/hr (250/GPU × 1) × 15 min = 63 SU',
    );
  });
});

describe('formatFitConfigSummary', () => {
  it('presents the scheduler cap as a cap, not promised concurrency', async () => {
    const { formatFitConfigSummary } = await import(
      '@/lib/models/launch-config'
    );
    const summary = formatFitConfigSummary(32_768, 1_024, 2, 4_096);
    expect(summary).toContain('cap 1,024');
    expect(summary).not.toContain('up to');
  });
});
