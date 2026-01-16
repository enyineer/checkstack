/**
 * Checkstack ESLint Plugin
 *
 * Custom ESLint rules for the Checkstack monorepo.
 */

import { noDirectRpcInComponents } from "./no-direct-rpc-in-components.mjs";
import { noMutationInDeps } from "./no-mutation-in-deps.mjs";
import { enforceArchitectureDeps } from "./enforce-architecture-deps.mjs";

export default {
  rules: {
    "no-direct-rpc-in-components": noDirectRpcInComponents,
    "no-mutation-in-deps": noMutationInDeps,
    "enforce-architecture-deps": enforceArchitectureDeps,
  },
};
