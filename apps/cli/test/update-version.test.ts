import assert from "node:assert/strict";
import test from "node:test";
import {
  compareReleaseVersions,
  isStableReleaseVersion,
  isUpdateAvailable,
  normalizeReleaseVersion,
} from "../src/update/version.js";

test("release versions normalize tags and preserve numeric build metadata", () => {
  assert.equal(normalizeReleaseVersion(" v0.1.1+13 "), "0.1.1+13");
  assert.equal(normalizeReleaseVersion("not-a-version"), null);
});

test("release comparison includes the numeric release build", () => {
  assert.equal(compareReleaseVersions("0.1.1+13", "0.1.1+12"), 1);
  assert.equal(compareReleaseVersions("0.1.1+12", "0.1.1+13"), -1);
  assert.equal(compareReleaseVersions("v0.1.1", "0.1.1"), 0);
  assert.equal(isUpdateAvailable("0.1.1+12", "v0.1.1+13"), true);
  assert.equal(isUpdateAvailable("0.1.2", "v0.1.1+99"), false);
});

test("only non-prerelease semantic versions are stable", () => {
  assert.equal(isStableReleaseVersion("v1.2.3"), true);
  assert.equal(isStableReleaseVersion("1.2.3+45"), true);
  assert.equal(isStableReleaseVersion("1.2.3-beta.1"), false);
  assert.equal(isStableReleaseVersion("latest"), false);
});

test("invalid versions cannot be compared", () => {
  assert.throws(
    () => compareReleaseVersions("invalid", "0.1.1"),
    /Invalid release version/,
  );
});
