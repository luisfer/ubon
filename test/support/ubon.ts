// Runs the CLI from source, for tests that spawn a process (MCP over stdio, exit codes).
import { run } from '../../src/cli/bin.ts';

await run();
