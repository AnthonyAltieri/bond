#!/usr/bin/env bun

import { runCli } from '../lib/cli.ts';

export { runCli, type CliDependencies } from '../lib/cli.ts';

if (import.meta.main) {
  const exitCode = await runCli(process.argv.slice(2));
  process.exit(exitCode);
}
