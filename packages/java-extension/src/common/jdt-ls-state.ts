/**
 * JDT Language Server lifecycle state — shared between browser and node.
 * Kept in common/ so browser/common modules never type-import from node/ (JV-P3-3).
 */
export type JdtLsState =
  | 'uninitialized'
  | 'starting'
  | 'initializing'
  | 'ready'
  | 'stopping'
  | 'stopped'
  | 'crashed'
  | 'failed';
