import { task } from "@capsule-run/sdk";

/**
 * This task should TIMEOUT because it sleeps longer than the configured timeout.
 */
export const testTimeout = task(
  {
    name: "testTimeout",
    timeout: "2s",
    compute: "HIGH"
  },
  async (): Promise<string> => {
    await new Promise(resolve => setTimeout(resolve, 10000));

    console.log("Sleep completed (this should NOT print)");
    return "TIMEOUT TEST FAILED - Should have timed out!";
  }
);

/**
 * This task should EXCEED compute limits with intensive CPU operations.
 */
export const testComputeLimitLow = task(
  {
    name: "testComputeLimitLow",
    compute: "LOW",
    timeout: "60s"
  },
  (): string => {
    let result = 0;

    for (let i = 0; i < 100000000; i++) {
      result += Math.sqrt(i) * Math.sin(i) * Math.cos(i);

      if (i % 1000 === 0) {
        result = result % 1000000;
      }
    }

    console.log("Computation completed (this should NOT print)");
    return `COMPUTE TEST FAILED - Should have run out of fuel! Result: ${result}`;
  }
);

/**
 * This task should EXCEED MEDIUM compute limits.
 */
export const testComputeLimitMedium = task(
  {
    name: "testComputeLimitMedium",
    compute: "MEDIUM",
    timeout: "60s"
  },
  (): string => {
    let result = 0;

    for (let i = 0; i < 10000000000; i++) {
      result += Math.sqrt(i) * Math.sin(i) * Math.cos(i) * Math.tan(i);

      if (i % 10000 === 0) {
        result = result % 1000000;
      }
    }

    console.log("Computation completed (this should NOT print)");
    return `COMPUTE TEST FAILED - Should have run out of fuel! Result: ${result}`;
  }
);

/**
 * This task should EXCEED RAM limits by allocating large arrays.
 */
export const testRAMLimit = task(
  {
    name: "testRAMLimit",
    ram: "10MB",
    compute: "HIGH",
    timeout: "30s"
  },
  async (): Promise<string> => {
    const arrays: number[][] = [];


    for (let i = 0; i < 1000; i++) {
      const largeArray = new Array(1000000).fill(0).map((_, idx) => idx * Math.random());
      arrays.push(largeArray);

      if (i % 10 === 0) {
        console.log(`📊 Allocated ${i} arrays (~${i * 8}MB)`);
      }
    }

    console.log("Memory allocation completed (this should NOT print)");
    return `RAM TEST FAILED - Should have run out of memory! Arrays: ${arrays.length}`;
  }
);

/**
 * This task tests multiple limits simultaneously:
 * - Very low timeout
 * - Low compute
 * - Low RAM
 */
export const testCombinedLimits = task(
  {
    name: "testCombinedLimits",
    timeout: "3s",
    compute: "LOW",
    ram: "5MB"
  },
  async (): Promise<string> => {
    const data: number[][] = [];
    let computeResult = 0;

    for (let i = 0; i < 100; i++) {
      data.push(new Array(100000).fill(0).map(() => Math.random()));

      for (let j = 0; j < 1000000; j++) {
        computeResult += Math.sqrt(j) * Math.sin(j);
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log("All operations completed (this should NOT print)");
    return `COMBINED TEST FAILED - Should have hit a limit! Data: ${data.length}, Compute: ${computeResult}`;
  }
);

/**
 * Tests timeout with multiple async operations.
 */
export const testAsyncTimeout = task(
  {
    name: "testAsyncTimeout",
    timeout: "5s",
    compute: "MEDIUM"
  },
  async (): Promise<string> => {
    const delays = [2000, 2000, 2000, 2000, 2000];

    for (let i = 0; i < delays.length; i++) {
      await new Promise(resolve => setTimeout(resolve, delays[i]));
      console.log(`✓ Delay ${i + 1} completed`);
    }

    console.log("All delays completed (this should NOT print)");
    return "ASYNC TIMEOUT TEST FAILED - Should have timed out!";
  }
);

export const testImmediateFuelExhaustion = task(
  {
    name: "testImmediateFuelExhaustion",
    compute: "LOW",
    timeout: "60s"
  },
  (): string => {
    let result = 0;
    const iterations = 1000000000;

    for (let i = 0; i < iterations; i++) {
      result += Math.pow(Math.sqrt(i), 2) * Math.sin(i) * Math.cos(i) * Math.tan(i) * Math.log(i + 1);

      if (i % 100000000 === 0 && i > 0) {
        console.log(`  Progress: ${(i / iterations * 100).toFixed(1)}%`);
      }
    }

    console.log("Completed (this should NOT print)");
    return `FUEL TEST FAILED - Result: ${result}`;
  }
);

/**
 * Main function to demonstrate all limit tests.
 *
 * Uncomment individual tests to run them one at a time.
 * Each test is designed to FAIL with a specific limit error.
 */
export const main = task(
  {
    name: "main",
    compute: "HIGH",
    timeout: "120s"
  },
  async (): Promise<void> => {
    // Test 1: Timeout
    // console.log("\n🧪 Running Test 1: Timeout Limit");
    // await testTimeout();

    // // Test 2: Low Compute
    // console.log("\n🧪 Running Test 2: LOW Compute Limit");
    // testComputeLimitLow();

    // // Test 3: Medium Compute
    // console.log("\n🧪 Running Test 3: MEDIUM Compute Limit");
    // testComputeLimitMedium();

    // Test 4: RAM Limit
    console.log("\n🧪 Running Test 4: RAM Limit");
    await testRAMLimit();

    // // Test 5: Combined Limits
    // console.log("\n🧪 Running Test 5: Combined Limits");
    // await testCombinedLimits();

    // // Test 6: Async Timeout
    // console.log("\n🧪 Running Test 6: Async Timeout");
    // await testAsyncTimeout();

    // // Test 7: Immediate Fuel Exhaustion
    // console.log("\n🧪 Running Test 7: Immediate Fuel Exhaustion");
    // testImmediateFuelExhaustion();

    console.log("\n limit testing completed.");
  }
);
