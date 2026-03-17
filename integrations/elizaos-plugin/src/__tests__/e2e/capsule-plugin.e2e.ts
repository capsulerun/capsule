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
      name: 'python_action_should_be_registered',
      fn: async (runtime: IAgentRuntime) => {
        const action = runtime.actions.find((a: Action) => a.name === 'EXECUTE_PYTHON');

        if (!action) {
          throw new Error('EXECUTE_PYTHON action is not registered');
        }

        if (!action.handler || typeof action.handler !== 'function') {
          throw new Error('EXECUTE_PYTHON handler is not a function');
        }

        logger.info('✓ EXECUTE_PYTHON action registered correctly');
      },
    },
    {
      name: 'javascript_action_should_be_registered',
      fn: async (runtime: IAgentRuntime) => {
        const action = runtime.actions.find((a: Action) => a.name === 'EXECUTE_JAVASCRIPT');

        if (!action) {
          throw new Error('EXECUTE_JAVASCRIPT action is not registered');
        }

        if (!action.handler || typeof action.handler !== 'function') {
          throw new Error('EXECUTE_JAVASCRIPT handler is not a function');
        }

        logger.info('✓ EXECUTE_JAVASCRIPT action registered correctly');
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
            text: 'x = 10 + 5\nx',
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

        const action = runtime.actions.find((a: Action) => a.name === 'EXECUTE_PYTHON');
        if (!action) {
          throw new Error('EXECUTE_PYTHON action not found');
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

        if (!result.data?.code) {
          throw new Error('Expected result.data.code to be present');
        }

        if (result.data.code !== testMessage.content.text) {
          throw new Error(`Expected code to match input: ${result.data.code}`);
        }

        if (result.data.language !== 'Python') {
          throw new Error(`Expected language to be 'Python', got: ${result.data.language}`);
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
            text: 'const x = 20 * 2;\nx',
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

        const action = runtime.actions.find((a: Action) => a.name === 'EXECUTE_JAVASCRIPT');
        if (!action) {
          throw new Error('EXECUTE_JAVASCRIPT action not found');
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

        if (!result.data?.code) {
          throw new Error('Expected result.data.code to be present');
        }

        if (result.data.code !== testMessage.content.text) {
          throw new Error(`Expected code to match input: ${result.data.code}`);
        }

        if (result.data.language !== 'JavaScript') {
          throw new Error(`Expected language to be 'JavaScript', got: ${result.data.language}`);
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
            text: 'print("Hello")\nprint("World")',
          } as Content,
          createdAt: Date.now(),
        };

        let responseText = '';

        const callback: HandlerCallback = async (response: Content): Promise<Memory[]> => {
          responseText = response.text || '';
          return [];
        };

        const action = runtime.actions.find((a: Action) => a.name === 'EXECUTE_PYTHON');
        if (!action) {
          throw new Error('EXECUTE_PYTHON action not found');
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
            text: 'console.log("Testing");\n42',
          } as Content,
          createdAt: Date.now(),
        };

        let responseText = '';

        const callback: HandlerCallback = async (response: Content): Promise<Memory[]> => {
          responseText = response.text || '';
          return [];
        };

        const action = runtime.actions.find((a: Action) => a.name === 'EXECUTE_JAVASCRIPT');
        if (!action) {
          throw new Error('EXECUTE_JAVASCRIPT action not found');
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
      name: 'should_execute_plain_python_code',
      fn: async (runtime: IAgentRuntime) => {
        const testMessage = {
          id: 'plain-python-test' as UUID,
          userId: 'test-user' as UUID,
          agentId: runtime.agentId,
          entityId: 'test-user' as UUID,
          roomId: 'plain-python-room' as UUID,
          content: {
            text: 'result = 5 * 10\nresult',
          } as Content,
          createdAt: Date.now(),
        };

        const action = runtime.actions.find((a: Action) => a.name === 'EXECUTE_PYTHON');
        if (!action) {
          throw new Error('EXECUTE_PYTHON action not found');
        }

        const result = await action.handler(runtime, testMessage, undefined, {});

        if (!result?.success) {
          throw new Error('Expected Python action to execute plain code successfully');
        }

        if (!result?.text?.includes('50')) {
          throw new Error(`Expected result to contain '50', got: ${result?.text}`);
        }

        if (!result.data?.code) {
          throw new Error('Expected result.data.code to be present');
        }

        if (result.data.code !== testMessage.content.text) {
          throw new Error(`Expected code to match input: ${result.data.code}`);
        }

        logger.info('✓ Python action executes plain code successfully');
      },
    },
    {
      name: 'should_execute_plain_javascript_code',
      fn: async (runtime: IAgentRuntime) => {
        const testMessage = {
          id: 'plain-js-test' as UUID,
          userId: 'test-user' as UUID,
          agentId: runtime.agentId,
          entityId: 'test-user' as UUID,
          roomId: 'plain-js-room' as UUID,
          content: {
            text: 'const result = 5 * 10;\nresult',
          } as Content,
          createdAt: Date.now(),
        };

        const action = runtime.actions.find((a: Action) => a.name === 'EXECUTE_JAVASCRIPT');
        if (!action) {
          throw new Error('EXECUTE_JAVASCRIPT action not found');
        }

        const result = await action.handler(runtime, testMessage, undefined, {});

        if (!result?.success) {
          throw new Error('Expected JavaScript action to execute plain code successfully');
        }

        if (!result?.text?.includes('50')) {
          throw new Error(`Expected result to contain '50', got: ${result?.text}`);
        }

        if (!result.data?.code) {
          throw new Error('Expected result.data.code to be present');
        }

        if (result.data.code !== testMessage.content.text) {
          throw new Error(`Expected code to match input: ${result.data.code}`);
        }

        logger.info('✓ JavaScript action executes plain code successfully');
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
            text: 'this is invalid python syntax!@#',
          } as Content,
          createdAt: Date.now(),
        };

        const action = runtime.actions.find((a: Action) => a.name === 'EXECUTE_PYTHON');
        if (!action) {
          throw new Error('EXECUTE_PYTHON action not found');
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
        const pythonAction = runtime.actions.find((a: Action) => a.name === 'EXECUTE_PYTHON');
        const jsAction = runtime.actions.find((a: Action) => a.name === 'EXECUTE_JAVASCRIPT');

        if (!pythonAction) {
          throw new Error('EXECUTE_PYTHON action not found');
        }

        if (!jsAction) {
          throw new Error('EXECUTE_JAVASCRIPT action not found');
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

        if (pythonAction.validate) {
          const isValid = await pythonAction.validate(runtime, testMessage, undefined);
          if (!isValid) {
            throw new Error('Python validate should always return true');
          }
        }

        if (jsAction.validate) {
          const isValid = await jsAction.validate(runtime, testMessage, undefined);
          if (!isValid) {
            throw new Error('JavaScript validate should always return true');
          }
        }

        logger.info('✓ Validate returns true for all messages');
      },
    },
  ],
};

export default CapsulePluginTestSuite;
