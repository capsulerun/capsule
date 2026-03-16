import {
  type Content,
  type HandlerCallback,
  type Memory,
  type UUID,
  type Plugin,
  type Action,
  type IAgentRuntime,
  type TestSuite,
  logger,
} from '@elizaos/core';

/**
 * E2E Test Suite for Capsule ElizaOS Plugin
 * ==========================================
 *
 * Tests the code execution functionality using Capsule sandboxes.
 * Validates Python and JavaScript execution in a real runtime environment.
 */
export const CapsulePluginTestSuite: TestSuite = {
  name: 'Capsule Plugin E2E Tests',
  tests: [
    {
      name: 'plugin_should_be_loaded',
      fn: async (runtime: IAgentRuntime) => {
        const plugin = runtime.plugins.find((p: Plugin) => p.name === 'capsule');

        if (!plugin) {
          throw new Error('Capsule plugin is not loaded in the runtime');
        }

        logger.info('✓ Capsule plugin loaded successfully');
      },
    },
    {
      name: 'execute_code_action_should_be_registered',
      fn: async (runtime: IAgentRuntime) => {
        const action = runtime.actions.find((a: Action) => a.name === 'EXECUTE_CODE');

        if (!action) {
          throw new Error('EXECUTE_CODE action is not registered');
        }

        if (!action.handler || typeof action.handler !== 'function') {
          throw new Error('EXECUTE_CODE handler is not a function');
        }

        logger.info('✓ EXECUTE_CODE action registered correctly');
      },
    },
    {
      name: 'should_execute_python_code',
      fn: async (runtime: IAgentRuntime) => {
        const testMessage = {
          id: 'python-test-1' as UUID,
          userId: 'test-user' as UUID,
          agentId: runtime.agentId,
          entityId: 'test-user' as UUID,
          roomId: 'python-test-room' as UUID,
          content: {
            text: 'Run this Python code:\n```python\nx = 10 + 5\nx\n```',
          } as Content,
          createdAt: Date.now(),
        };

        let callbackExecuted = false;
        let responseText = '';

        const callback: HandlerCallback = async (response: Content): Promise<Memory[]> => {
          callbackExecuted = true;
          responseText = response.text || '';
          const responseMemory: Memory = {
            id: 'response-python' as UUID,
            entityId: runtime.agentId,
            agentId: runtime.agentId,
            roomId: 'python-test-room' as UUID,
            content: response,
            createdAt: Date.now(),
            embedding: [],
          };
          return [responseMemory];
        };

        const action = runtime.actions.find((a: Action) => a.name === 'EXECUTE_CODE');
        if (!action) {
          throw new Error('EXECUTE_CODE action not found');
        }

        const result = await action.handler(runtime, testMessage, undefined, {}, callback);

        if (!result || !result.success) {
          throw new Error('Python code execution failed');
        }

        if (!callbackExecuted) {
          throw new Error('Callback was not executed');
        }

        if (!responseText.includes('15')) {
          throw new Error(`Expected result to contain '15', got: ${responseText}`);
        }

        logger.info(`✓ Python code executed successfully: "${responseText}"`);
      },
    },
    {
      name: 'should_execute_javascript_code',
      fn: async (runtime: IAgentRuntime) => {
        const testMessage = {
          id: 'js-test-1' as UUID,
          userId: 'test-user' as UUID,
          agentId: runtime.agentId,
          entityId: 'test-user' as UUID,
          roomId: 'js-test-room' as UUID,
          content: {
            text: 'Run this JavaScript:\n```javascript\nconst x = 20 * 2;\nx\n```',
          } as Content,
          createdAt: Date.now(),
        };

        let callbackExecuted = false;
        let responseText = '';

        const callback: HandlerCallback = async (response: Content): Promise<Memory[]> => {
          callbackExecuted = true;
          responseText = response.text || '';
          const responseMemory: Memory = {
            id: 'response-js' as UUID,
            entityId: runtime.agentId,
            agentId: runtime.agentId,
            roomId: 'js-test-room' as UUID,
            content: response,
            createdAt: Date.now(),
            embedding: [],
          };
          return [responseMemory];
        };

        const action = runtime.actions.find((a: Action) => a.name === 'EXECUTE_CODE');
        if (!action) {
          throw new Error('EXECUTE_CODE action not found');
        }

        const result = await action.handler(runtime, testMessage, undefined, {}, callback);

        if (!result || !result.success) {
          throw new Error('JavaScript code execution failed');
        }

        if (!callbackExecuted) {
          throw new Error('Callback was not executed');
        }

        if (!responseText.includes('40')) {
          throw new Error(`Expected result to contain '40', got: ${responseText}`);
        }

        logger.info(`✓ JavaScript code executed successfully: "${responseText}"`);
      },
    },
    {
      name: 'should_handle_python_print_statements',
      fn: async (runtime: IAgentRuntime) => {
        const testMessage = {
          id: 'python-print-test' as UUID,
          userId: 'test-user' as UUID,
          agentId: runtime.agentId,
          entityId: 'test-user' as UUID,
          roomId: 'python-print-room' as UUID,
          content: {
            text: '```python\nprint("Hello")\nprint("World")\n```',
          } as Content,
          createdAt: Date.now(),
        };

        let responseText = '';

        const callback: HandlerCallback = async (response: Content): Promise<Memory[]> => {
          responseText = response.text || '';
          return [];
        };

        const action = runtime.actions.find((a: Action) => a.name === 'EXECUTE_CODE');
        if (!action) {
          throw new Error('EXECUTE_CODE action not found');
        }

        const result = await action.handler(runtime, testMessage, undefined, {}, callback);

        if (!result || !result.success) {
          throw new Error('Python print execution failed');
        }

        if (!responseText.includes('Hello') || !responseText.includes('World')) {
          throw new Error(`Expected output to contain 'Hello' and 'World', got: ${responseText}`);
        }

        logger.info(`✓ Python print statements handled correctly`);
      },
    },
    {
      name: 'should_handle_javascript_console_log',
      fn: async (runtime: IAgentRuntime) => {
        const testMessage = {
          id: 'js-console-test' as UUID,
          userId: 'test-user' as UUID,
          agentId: runtime.agentId,
          entityId: 'test-user' as UUID,
          roomId: 'js-console-room' as UUID,
          content: {
            text: '```javascript\nconsole.log("Testing");\n42\n```',
          } as Content,
          createdAt: Date.now(),
        };

        let responseText = '';

        const callback: HandlerCallback = async (response: Content): Promise<Memory[]> => {
          responseText = response.text || '';
          return [];
        };

        const action = runtime.actions.find((a: Action) => a.name === 'EXECUTE_CODE');
        if (!action) {
          throw new Error('EXECUTE_CODE action not found');
        }

        const result = await action.handler(runtime, testMessage, undefined, {}, callback);

        if (!result || !result.success) {
          throw new Error('JavaScript console.log execution failed');
        }

        if (!responseText.includes('Testing') || !responseText.includes('42')) {
          throw new Error(`Expected output to contain 'Testing' and '42', got: ${responseText}`);
        }

        logger.info(`✓ JavaScript console.log handled correctly`);
      },
    },
    {
      name: 'should_return_error_for_missing_code_block',
      fn: async (runtime: IAgentRuntime) => {
        const testMessage = {
          id: 'error-test-1' as UUID,
          userId: 'test-user' as UUID,
          agentId: runtime.agentId,
          entityId: 'test-user' as UUID,
          roomId: 'error-test-room' as UUID,
          content: {
            text: 'Just some text without code blocks',
          } as Content,
          createdAt: Date.now(),
        };

        const action = runtime.actions.find((a: Action) => a.name === 'EXECUTE_CODE');
        if (!action) {
          throw new Error('EXECUTE_CODE action not found');
        }

        const result = await action.handler(runtime, testMessage, undefined, {});

        if (result?.success) {
          throw new Error('Expected action to fail with missing code block');
        }

        if (!result?.error || !(result.error as Error)?.message?.includes('code block')) {
          throw new Error('Expected error message about missing code block');
        }

        logger.info('✓ Error handling works correctly for missing code blocks');
      },
    },
    {
      name: 'should_handle_syntax_errors_gracefully',
      fn: async (runtime: IAgentRuntime) => {
        const testMessage = {
          id: 'syntax-error-test' as UUID,
          userId: 'test-user' as UUID,
          agentId: runtime.agentId,
          entityId: 'test-user' as UUID,
          roomId: 'syntax-error-room' as UUID,
          content: {
            text: '```python\nthis is invalid python syntax!@#\n```',
          } as Content,
          createdAt: Date.now(),
        };

        const action = runtime.actions.find((a: Action) => a.name === 'EXECUTE_CODE');
        if (!action) {
          throw new Error('EXECUTE_CODE action not found');
        }

        const result = await action.handler(runtime, testMessage, undefined, {});

        if (result?.success) {
          throw new Error('Expected action to fail with syntax error');
        }

        if (!result?.error) {
          throw new Error('Expected error object for syntax error');
        }

        logger.info('✓ Syntax errors are handled gracefully');
      },
    },
    {
      name: 'validate_should_always_return_true',
      fn: async (runtime: IAgentRuntime) => {
        const action = runtime.actions.find((a: Action) => a.name === 'EXECUTE_CODE');
        if (!action) {
          throw new Error('EXECUTE_CODE action not found');
        }

        const testMessage = {
          id: 'validate-test' as UUID,
          userId: 'test-user' as UUID,
          agentId: runtime.agentId,
          entityId: 'test-user' as UUID,
          roomId: 'validate-room' as UUID,
          content: {
            text: 'random text that should still validate',
          } as Content,
          createdAt: Date.now(),
        };


        if (action.validate) {
          console.log("validate", action.validate);
          const isValid = await action.validate(runtime, testMessage, undefined);
          if (!isValid) {
            throw new Error('Validate should always return true');
          }
        }

        logger.info('✓ Validate returns true for all messages');
      },
    },
  ],
};

export default CapsulePluginTestSuite;
