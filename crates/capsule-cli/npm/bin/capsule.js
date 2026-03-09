#!/usr/bin/env node

const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const PLATFORMS = {
  "darwin-arm64": "@capsule-run/cli-darwin-arm64",
  "darwin-x64": "@capsule-run/cli-darwin-x64",
  "linux-x64": "@capsule-run/cli-linux-x64",
  "linux-arm64": "@capsule-run/cli-linux-arm64",
  "win32-x64": "@capsule-run/cli-win32-x64",
};

function getPlatformPackage() {
  const key = `${process.platform}-${process.arch}`;
  return PLATFORMS[key];
}

function findBinary() {
  const pkg = getPlatformPackage();
  if (!pkg) {
    console.error(`Unsupported platform: ${process.platform}-${process.arch}`);
    process.exit(1);
  }

  try {
    const pkgPath = require.resolve(`${pkg}/package.json`);
    const pkgDir = path.dirname(pkgPath);
    const binary = process.platform === "win32" ? "capsule.exe" : "capsule";
    const binaryPath = path.join(pkgDir, binary);

    if (fs.existsSync(binaryPath)) {
      return binaryPath;
    }
  } catch {
    // Package not found
  }

  console.error(`Could not find capsule binary for ${process.platform}-${process.arch}`);
  console.error(`Please ensure @capsule-run/cli is installed correctly.`);
  process.exit(1);
}

const result = spawnSync(findBinary(), process.argv.slice(2), { stdio: "inherit" });

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
