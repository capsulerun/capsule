import { task } from "@capsule-run/sdk";

export const executeCode = task(
  { name: "executeCode", compute: "LOW", ram: "256MB"},
  async (code: string): Promise<any> => {
    const capturedOutput: string[] = [];
    const originalLog = console.log;

    console.log = (...args: any[]) => {
      capturedOutput.push(args.map(arg => String(arg)).join(' '));
    };

    try {
      let result;
      try {
        result = eval(code);
      } catch (e) {
        if (e instanceof SyntaxError && e.message.includes("return")) {
          const fn = new Function(code);
          result = fn();
        } else {
          throw e;
        }
      }

      const output = capturedOutput.join('\n');

      if (output) {
        if (result !== undefined) {
          return output + '\n' + result;
        }
        return output;
      }

      return result;
    } finally {
      console.log = originalLog;
    }
  }
);

export const main = task(
  { name: "main", compute: "HIGH"},
  async (code: string): Promise<any> => {
    const response = await executeCode(code);
    if(!response.success && response.error) {
      throw new Error(response.error.message);
    }

    return response.result;
  }
);
