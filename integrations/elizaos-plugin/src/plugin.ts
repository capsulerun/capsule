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
    _runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options: Record<string, unknown> = {},
    callback?: HandlerCallback,
    _responses?: Memory[]
  ): Promise<ActionResult> => {
    try {
      const code = message.content.text || '';
      logger.info(`Executing Python code`);
      const result = await runPython(code);

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
          text: '5050',
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
          text: '[42, 17, 89, 3, 56, 91, 24, 67, 8, 45]',
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
          text: 'True',
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
    _runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options: Record<string, unknown> = {},
    callback?: HandlerCallback,
    _responses?: Memory[]
  ): Promise<ActionResult> => {
    try {
      const code = message.content.text || '';

      logger.info(`Executing JavaScript code`);
      const result = await runJavaScript(code);

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
        error: error instanceof Error ? error : new Error(String(error)),
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
          text: '[1,2,5,8,9]',
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
          text: 'John',
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
          text: '15',
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
          text: 'olleh',
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
