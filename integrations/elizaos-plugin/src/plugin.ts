import type { Plugin } from '@elizaos/core';
import {
  type Action,
  type ActionResult,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  ModelType,
  type State,
  logger
} from '@elizaos/core';
import { runPython, runJavaScript, loadSandboxes } from '@capsule-run/adapter';
import { CapsulePluginTestSuite } from './__tests__/e2e/capsule-plugin.e2e.js';


/**
 * Action representing Python code execution.
 * @typedef {Object} Action
 * @property {string} name - The name of the action.
 * @property {string[]} similes - An array of related actions.
 * @property {string} description - A brief description of the action.
 * @property {Function} validate - Asynchronous function to validate the action.
 * @property {Function} handler - Asynchronous function to handle the action and execute code.
 * @property {Object[]} examples - An array of example inputs and expected outputs for the action.
 */
const pythonCodeAction: Action = {
  name: 'EXECUTE_PYTHON',
  similes: ['RUN_PYTHON', 'EVAL_PYTHON', 'PYTHON_EXEC', 'RUN_PY'],
  description: 'Executes Python code in a secure Capsule sandbox. Both standard output (print statements) and the last evaluated expression are returned. Supports pure Python only (no C extensions like numpy/pandas).',

  validate: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State | undefined
  ): Promise<boolean> => {
    return true;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options: Record<string, unknown> = {},
    callback?: HandlerCallback,
    responses?: Memory[]
  ): Promise<ActionResult> => {
    const code = responses?.[0]?.content?.text || message.content.text || '';

    const response = await runtime.useModel(ModelType.MEDIUM, {
      prompt: `
        Generate a python code with the following rules:\n
        - Both standard output (print statements) and the last evaluated expression are returned\n
        - Supports pure Python only (no C extensions like numpy/pandas).\n
        - No explanation, just the code\n
        Here is the problem to solve:\n
        ${message.content.text}
      `,
      temperature: 0.5
    });


    const codeMatch = response.match(/```python\n([\s\S]*?)```/);

    try {
      const result = await runPython(codeMatch ? codeMatch[1] : code);

      if (callback) {
        await callback({
          text: result,
          actions: ['EXECUTE_PYTHON'],
          source: message.content.source,
        });
      }

      return {
        text: result,
        success: true,
        data: {
          actions: ['EXECUTE_PYTHON'],
          source: message.content.source,
          language: 'Python',
          code,
          result,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Python code execution failed: ${errorMessage}`);
      return {
        success: false,
        error: String(error),
        data: {
          actions: ['EXECUTE_PYTHON'],
          source: message.content.source,
          language: 'Python',
          code,
          result: errorMessage,
        },
      };
    }
  },

  examples: [
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Calculate 156 * 23 for me',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: '156 * 23',
          actions: ['EXECUTE_PYTHON'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'What is the sum of numbers from 1 to 100?',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: 'sum(range(1, 101))',
          actions: ['EXECUTE_PYTHON'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Generate 10 random numbers between 1 and 100',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: 'import random\n[random.randint(1, 100) for _ in range(10)]',
          actions: ['EXECUTE_PYTHON'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Check if 17 is a prime number',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: 'n = 17\nn > 1 and all(n % i != 0 for i in range(2, int(n**0.5) + 1))',
          actions: ['EXECUTE_PYTHON'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Calculate the factorial of 8',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: 'import math\nmath.factorial(8)',
          actions: ['EXECUTE_PYTHON'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Find the average of these numbers: 12, 45, 23, 67, 89',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: 'numbers = [12, 45, 23, 67, 89]\nsum(numbers) / len(numbers)',
          actions: ['EXECUTE_PYTHON'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Convert celsius 25 to fahrenheit',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: 'celsius = 25\n(celsius * 9/5) + 32',
          actions: ['EXECUTE_PYTHON'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Find the fibonacci number at position 10',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: 'def fib(n):\n    a, b = 0, 1\n    for _ in range(n):\n        a, b = b, a + b\n    return a\nfib(10)',
          actions: ['EXECUTE_PYTHON'],
        },
      },
    ],
  ],
};

/**
 * Action representing JavaScript code execution.
 * @typedef {Object} Action
 * @property {string} name - The name of the action.
 * @property {string[]} similes - An array of related actions.
 * @property {string} description - A brief description of the action.
 * @property {Function} validate - Asynchronous function to validate the action.
 * @property {Function} handler - Asynchronous function to handle the action and execute code.
 * @property {Object[]} examples - An array of example inputs and expected outputs for the action.
 */
const javascriptCodeAction: Action = {
  name: 'EXECUTE_JAVASCRIPT',
  similes: ['RUN_JAVASCRIPT', 'EVAL_JAVASCRIPT', 'JAVASCRIPT_EXEC', 'RUN_JS', 'EVAL_JS'],
  description: 'Executes JavaScript code in a secure Capsule sandbox. Both standard output (console.log statements) and the last evaluated expression are returned.',

  validate: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State | undefined
  ): Promise<boolean> => {
    return true;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options: Record<string, unknown> = {},
    callback?: HandlerCallback,
    responses?: Memory[]
  ): Promise<ActionResult> => {
    const code = responses?.[0]?.content?.text || message.content.text || '';

    const response = await runtime.useModel(ModelType.MEDIUM, {
      prompt: `
        Generate a javascript code with the following rules:\n
        - Both standard output (console.log statements) and the last evaluated expression are returned\n
        - No explanation, just the code\n
        Here is the problem to solve:\n
        ${message.content.text}
      `,
      temperature: 0.5
    });


    const codeMatch = response.match(/```javascript\n([\s\S]*?)```/);

    try {
      logger.info(`Executing JavaScript code`);
      const result = await runJavaScript(codeMatch ? codeMatch[1] : code);

      if (callback) {
        await callback({
          text: result,
          actions: ['EXECUTE_JAVASCRIPT'],
          source: message.content.source,
        });
      }

      return {
        text: result,
        success: true,
        data: {
          actions: ['EXECUTE_JAVASCRIPT'],
          source: message.content.source,
          language: 'JavaScript',
          code,
          result,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`JavaScript code execution failed: ${errorMessage}`);
      return {
        success: false,
        error: String(error),
        data: {
          actions: ['EXECUTE_JAVASCRIPT'],
          source: message.content.source,
          language: 'JavaScript',
          code,
          result: errorMessage,
        },
      };
    }
  },

  examples: [
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Sort this array: [5, 2, 8, 1, 9]',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: '[5, 2, 8, 1, 9].sort((a, b) => a - b)',
          actions: ['EXECUTE_JAVASCRIPT'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Parse this JSON and get the name field: {"name":"John","age":30}',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: 'const obj = JSON.parse(\'{"name":"John","age":30}\');\nobj.name',
          actions: ['EXECUTE_JAVASCRIPT'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Calculate the sum of array [1, 2, 3, 4, 5]',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: '[1, 2, 3, 4, 5].reduce((sum, num) => sum + num, 0)',
          actions: ['EXECUTE_JAVASCRIPT'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Reverse the string "hello"',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: '"hello".split("").reverse().join("")',
          actions: ['EXECUTE_JAVASCRIPT'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Filter even numbers from [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: '[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].filter(n => n % 2 === 0)',
          actions: ['EXECUTE_JAVASCRIPT'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Convert this array to uppercase: ["hello", "world"]',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: '["hello", "world"].map(s => s.toUpperCase())',
          actions: ['EXECUTE_JAVASCRIPT'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Find the maximum value in [23, 45, 12, 67, 34]',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: 'Math.max(...[23, 45, 12, 67, 34])',
          actions: ['EXECUTE_JAVASCRIPT'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Count how many times "a" appears in "banana"',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: '"banana".split("a").length - 1',
          actions: ['EXECUTE_JAVASCRIPT'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Generate an array of numbers from 1 to 10',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: 'Array.from({length: 10}, (_, i) => i + 1)',
          actions: ['EXECUTE_JAVASCRIPT'],
        },
      },
    ],
  ],
};

export const capsulePlugin: Plugin = {
  name: 'capsule',
  description: 'Capsule code execution plugin for ElizaOS',
  async init() {
    logger.info('Initializing Capsule plugin');
    logger.info('Preloading Capsule sandboxes...');
    await loadSandboxes();
    logger.info('Capsule sandboxes ready');
  },
  actions: [pythonCodeAction, javascriptCodeAction],
  tests: [CapsulePluginTestSuite],
};

export default capsulePlugin;
