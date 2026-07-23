import assert from "node:assert/strict";
import test from "node:test";
import { DaemonClientError } from "@repo/daemon-client";
import { updateCommand } from "../src/commands/update.js";
import { configureUi } from "../src/ui/index.js";
import type { UpdateStatus } from "../src/update/checker.js";

function captureUi(
  options: {
    tty?: boolean;
    json?: boolean;
    quiet?: boolean;
    yes?: boolean;
    commandName?: string;
  } = {},
) {
  const output: string[] = [];
  const errors: string[] = [];
  const tty = options.tty ?? false;
  const writer = (target: string[]) => ({
    isTTY: tty,
    columns: 100,
    write(chunk: string) {
      target.push(chunk);
    },
  });
  configureUi(
    {
      noColor: true,
      json: options.json,
      quiet: options.quiet,
      yes: options.yes,
    },
    {
      input: { isTTY: tty },
      output: writer(output),
      error: writer(errors),
      isTTY: tty,
      commandName: options.commandName,
    },
  );
  return {
    output: () => output.join(""),
    errors: () => errors.join(""),
  };
}

function status(input: Partial<UpdateStatus> = {}): UpdateStatus {
  const currentVersion = input.currentVersion ?? "0.1.1+12";
  const latestVersion = input.latestVersion ?? "0.1.1+13";
  const releaseUrl =
    input.releaseUrl ??
    "https://github.com/VeguiDev/vcontext/releases/tag/v0.1.1%2B13";
  return {
    currentVersion,
    latestVersion,
    updateAvailable: input.updateAvailable ?? true,
    releaseUrl,
    release: input.release ?? {
      version: latestVersion,
      tag: `v${latestVersion}`,
      releaseUrl,
      assets: [],
    },
    fromCache: input.fromCache ?? false,
    stale: input.stale ?? false,
  };
}

test("update --check exposes a stable machine-readable status", async () => {
  const capture = captureUi({ json: true });
  await updateCommand(["--check", "--json"], {
    check: async () => status(),
  });
  assert.deepEqual(JSON.parse(capture.output()), {
    currentVersion: "0.1.1+12",
    latestVersion: "0.1.1+13",
    updateAvailable: true,
    releaseUrl: "https://github.com/VeguiDev/vcontext/releases/tag/v0.1.1%2B13",
  });
  assert.equal(capture.errors(), "");
});

test("development installations are never overwritten", async () => {
  captureUi({ commandName: "vcontext-dev" });
  await assert.rejects(
    updateCommand([], {
      standalone: false,
      check: async () => {
        throw new Error("must not check");
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof DaemonClientError);
      assert.equal(error.code, "UPDATE_UNSUPPORTED");
      assert.match(error.hint ?? "", /development repository was not modified/);
      return true;
    },
  );
});

test("non-interactive updates require --yes", async () => {
  captureUi();
  await assert.rejects(
    updateCommand([], {
      standalone: true,
      check: async () => status(),
    }),
    (error: unknown) => {
      assert.ok(error instanceof DaemonClientError);
      assert.equal(error.code, "CONFIRMATION_REQUIRED");
      assert.equal(error.exitCode, 10);
      return true;
    },
  );
});

test("--yes installs an available standalone update", async () => {
  const capture = captureUi({ yes: true });
  let installed: UpdateStatus | undefined;
  await updateCommand([], {
    standalone: true,
    check: async () => status(),
    install: async (value) => {
      installed = value;
      return {
        updated: true,
        scheduled: false,
        previousVersion: value.currentVersion,
        currentVersion: value.latestVersion,
        targetPath: "/usr/local/bin/vcontext",
      };
    },
  });

  assert.equal(installed?.latestVersion, "0.1.1+13");
  assert.equal(capture.output(), "Updated vcontext 0.1.1+12 → 0.1.1+13\n");
});

test("an up-to-date CLI does not request confirmation or install", async () => {
  const capture = captureUi();
  let installs = 0;
  await updateCommand([], {
    standalone: true,
    check: async () =>
      status({
        latestVersion: "0.1.1+12",
        updateAvailable: false,
      }),
    install: async () => {
      installs += 1;
      throw new Error("must not install");
    },
  });
  assert.equal(installs, 0);
  assert.equal(capture.output(), "vcontext 0.1.1+12 is up to date\n");
});
