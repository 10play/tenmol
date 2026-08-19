import { describe } from 'vitest';
import { registerShard } from './probe-replay';

// Shard 7 of 8. Probes are round-robin-assigned to shards (see registerShard) so
// vitest's worker pool replays them in parallel; the split keeps each spec file's
// wall-clock bounded. Do not renumber without updating its siblings.
describe('probe-replay (shard 7/8): engine-ts output still equals oracle-verified expected', () => {
  registerShard(7, 8);
});
