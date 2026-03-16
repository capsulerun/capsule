import type { Plugin } from '@elizaos/core';
import {
  type Action,
  type ActionResult,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  type State,
  logger,
} from '@elizaos/core';
import { runPython, runJavaScript, loadSandboxes } from '@capsule-run/adapter';
import { CapsulePluginTestSuite } from './__tests__/e2e/capsule-plugin.e2e.js';


/**
 * Action representing code execution.
 * @typedef {Object} Action
 * @property {string} name - The name of the action.
 * @property {string[]} similes - An array of related actions.
 * @property {string} description - A brief description of the action.
 * @property {Function} validate - Asynchronous function to validate the action.
 * @property {Function} handler - Asynchronous function to handle the action and execute code.
 * @property {Object[]} examples - An array of example inputs and expected outputs for the action.
 */
const executeCodeAction: Action = {
  name: 'EXECUTE_CODE',
  similes: ['RUN_CODE', 'EVAL_CODE', 'CODE_EXEC', 'RUN_PYTHON', 'RUN_JAVASCRIPT'],
  description: 'Executes Python or JavaScript code in a secure Capsule sandbox',

  validate: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State | undefined
  ): Promise<boolean> => {
    return true;
  },

  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options: Record<string, unknown> = {},
    callback?: HandlerCallback,
    _responses?: Memory[]
  ): Promise<ActionResult> => {
    try {
      const text = message.content.text || '';

      const pythonMatch = text.match(/```python\n([\s\S]*?)\n```/);
      const jsMatch = text.match(/```(?:javascript|js)\n([\s\S]*?)\n```/);

      let result: string;
      let language: string;

      if (pythonMatch) {
        language = 'Python';
        const code = pythonMatch[1];
        logger.info(`Executing Python code`);
        result = await runPython(code);
      } else if (jsMatch) {
        language = 'JavaScript';
        const code = jsMatch[1];
        logger.info(`Executing JavaScript code`);
        result = await runJavaScript(code);
      } else {
        return {
          success: false,
          error: new Error('No code block found. Please wrap your code in ```python or ```javascript code blocks'),
        };
      }

      if (callback) {
        await callback({
          text: result,
          actions: ['EXECUTE_CODE'],
          source: message.content.source,
        });
      }

      return {
        text: result,
        success: true,
        data: {
          actions: ['EXECUTE_CODE'],
          source: message.content.source,
          language,
          result,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Code execution failed: ${errorMessage}`);
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
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
          text: '3588',
          actions: ['EXECUTE_CODE'],
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
          text: '5050',
          actions: ['EXECUTE_CODE'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Can you run this Python code?\n```python\nprint("Hello from Python!")\nx = 5 + 3\nx * 2\n```',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: 'Hello from Python!\n16',
          actions: ['EXECUTE_CODE'],
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
          text: '[42, 17, 89, 3, 56, 91, 24, 67, 8, 45]',
          actions: ['EXECUTE_CODE'],
        },
      },
    ],
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
          text: '[1,2,5,8,9]',
          actions: ['EXECUTE_CODE'],
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
          text: 'John',
          actions: ['EXECUTE_CODE'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Run this JavaScript:\n```javascript\nconst arr = [1, 2, 3, 4, 5];\nconst sum = arr.reduce((a, b) => a + b, 0);\nsum\n```',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: '15',
          actions: ['EXECUTE_CODE'],
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
  actions: [executeCodeAction],
  tests: [CapsulePluginTestSuite],
};

export default capsulePlugin;
