#!/usr/bin/env bun
const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;
if (!tag) throw new Error("A tag is required.");
const match = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.exec(tag);
if (!match) throw new Error(`Tag ${tag} is not valid semantic versioning (expected vX.Y.Z).`);
const pkg = await Bun.file("apps/cli/package.json").json() as { version: string };
if (tag.slice(1) !== pkg.version) throw new Error(`Tag ${tag} does not match apps/cli/package.json version ${pkg.version}.`);
console.log(`Release version ${tag} validated.`);