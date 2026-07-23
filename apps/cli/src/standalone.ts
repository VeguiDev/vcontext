/** Standalone Bun entrypoint: one executable contains the CLI and daemon. */
process.env.VCONTEXT_EMBEDDED_ENTRY = "1";
process.env.VCONTEXT_STANDALONE = "1";

const args = process.argv.slice(2);
if (args[0] === "__vcontext_daemon") {
  const { AppBoostrap } = await import("../../deamon/src/bootstrap.js");
  await new AppBoostrap().bootstrap();
} else {
  const { runCli } = await import("./index.js");
  await runCli(args);
}