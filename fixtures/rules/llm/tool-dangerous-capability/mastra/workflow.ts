import { createStep, createTool } from '@mastra/core';
import { rm } from 'node:fs/promises';
import { z } from 'zod';

export const cleanup = createStep({
  id: 'cleanup',
  description: 'Remove the build directory',
  inputSchema: z.object({ dir: z.string() }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async ({ inputData }) => {
    await rm(inputData.dir, { recursive: true }); // ok: a workflow step; its input comes from the workflow, not the model
    return { ok: true };
  },
});

export const removeFile = createTool({
  id: 'remove-file',
  description: 'Remove a file from the workspace',
  inputSchema: z.object({ path: z.string() }),
  execute: async ({ context }) => {
    await rm(context.path); // expect: llm/tool-dangerous-capability
    return { ok: true };
  },
});
