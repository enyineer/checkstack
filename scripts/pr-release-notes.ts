/**
 * PR Release Notes Script
 *
 * Prints the de-duplicated release changelog for the Version Packages PR body.
 *
 * The `changesets/action@v1` "version" step generates that PR body itself, one
 * section per bumped package (not configurable), so the same change shows up
 * once per package. The release workflow runs this script against the PR
 * branch's post-`changeset version` CHANGELOGs to overwrite the body with a
 * de-duplicated version (each change listed once with the packages it touched).
 *
 * PR bodies allow far more than the GitHub release-body limit, so this prints
 * the full untruncated form. This is best-effort: it must never block a
 * release, so the workflow step runs with `continue-on-error: true`.
 */

import { buildDeduplicatedReleaseNotes } from "./aggregate-changelog";

const markdown = await buildDeduplicatedReleaseNotes();
console.log(markdown);
