import { task } from "@capsule-run/sdk";

export const executeCode = task(
  { name: "executeCode", compute: "LOW", ram: "256MB"},
  async (code: string): Promise<any> => {
    try {
      return eval(code);
    } catch (e) {
      if (e instanceof SyntaxError && e.message.includes("return")) {
        const fn = new Function(code);
        return fn();
      }
      throw e;
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
