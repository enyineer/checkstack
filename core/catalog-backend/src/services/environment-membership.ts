/**
 * Pure desired-set membership diff for systems <-> environments.
 *
 * Both the `setSystemEnvironments` RPC and the GitOps
 * `System -> environments` reconcile compute the same add/prune diff
 * against current membership. Keeping it pure (no DB) makes it
 * straightforward to unit-test without a database harness.
 */

export interface MembershipDiff {
  /** Environment ids to associate that are not currently linked. */
  toAdd: string[];
  /** Currently-linked environment ids no longer in the desired set. */
  toRemove: string[];
}

/**
 * Diff a desired environment-id set against the current set.
 * Order-independent; de-duplicates the desired set.
 */
export function diffSystemEnvironments(props: {
  current: ReadonlyArray<string>;
  desired: ReadonlyArray<string>;
}): MembershipDiff {
  const { current, desired } = props;
  const currentSet = new Set(current);
  const desiredSet = new Set(desired);

  const toAdd: string[] = [];
  for (const id of desiredSet) {
    if (!currentSet.has(id)) toAdd.push(id);
  }

  const toRemove: string[] = [];
  for (const id of currentSet) {
    if (!desiredSet.has(id)) toRemove.push(id);
  }

  return { toAdd, toRemove };
}
