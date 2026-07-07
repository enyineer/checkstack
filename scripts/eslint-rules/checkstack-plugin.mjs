/**
 * Checkstack ESLint Plugin
 *
 * Custom ESLint rules for the Checkstack monorepo.
 */

import { noDirectRpcInComponents } from "./no-direct-rpc-in-components.mjs";
import { noMutationInDeps } from "./no-mutation-in-deps.mjs";
import { enforceArchitectureDeps } from "./enforce-architecture-deps.mjs";
import { noExtraneousRuntimeDeps } from "./no-extraneous-runtime-deps.mjs";
import enforcePackageMetadata from "./enforce-package-metadata.mjs";
import { noEslintDisableAny } from "./no-eslint-disable-any.mjs";
import { noUnmanagedEntityState } from "./no-unmanaged-entity-state.mjs";
import { noPodLocalEntityState } from "./no-pod-local-entity-state.mjs";
import { noUnguardedAnimation } from "./no-unguarded-animation.mjs";
import { preferGatedMutation } from "./prefer-gated-mutation.mjs";

export default {
  rules: {
    "no-direct-rpc-in-components": noDirectRpcInComponents,
    "no-mutation-in-deps": noMutationInDeps,
    "enforce-architecture-deps": enforceArchitectureDeps,
    "no-extraneous-runtime-deps": noExtraneousRuntimeDeps,
    "enforce-package-metadata": enforcePackageMetadata,
    "no-eslint-disable-any": noEslintDisableAny,
    "no-unmanaged-entity-state": noUnmanagedEntityState,
    "no-pod-local-entity-state": noPodLocalEntityState,
    "no-unguarded-animation": noUnguardedAnimation,
    "prefer-gated-mutation": preferGatedMutation,
  },
};
