import { task } from "@capsule-run/sdk";

export const main = task({
  name: "main",
  compute: "HIGH",
  ram: "64MB",
  timeout: "10s"
}, (code: string): unknown => {
  const fn = new Function(code);
  return fn();
});
