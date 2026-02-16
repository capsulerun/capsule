import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { run } from '@capsule-run/sdk/runner';

export const executeCode = createTool({
  id: 'execute-code',
  description: 'Safely execute JavaScript code in an isolated Capsule sandbox. The code should include a return statement to produce output.',
  inputSchema: z.object({
    code: z.string().describe('JavaScript code to execute. Must include a return statement, e.g. "return 1 + 2"'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    result: z.any(),
    error: z.string().nullable(),
    duration_ms: z.number(),
  }),
  execute: async ({ code }: { code: string }) => {
    try {
      const result = await run({
        file: '../../capsule.ts',
        args: [code],
      });

      return {
        success: result.success,
        result: result.result,
        error: result.error ? result.error.message : null,
        duration_ms: result.execution.duration_ms,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        result: null,
        error: message,
        duration_ms: 0,
      };
    }
  },
});
