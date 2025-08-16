#!/usr/bin/env node

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function getGitInfo() {
  try {
    const commitHash = execSync("git rev-parse HEAD", {
      encoding: "utf8",
    }).trim();
    const commitDate = execSync("git log -1 --format=%cI", {
      encoding: "utf8",
    }).trim();

    return {
      NEXT_PUBLIC_GIT_COMMIT_HASH: commitHash,
      NEXT_PUBLIC_GIT_COMMIT_DATE: commitDate,
      GIT_COMMIT_HASH: commitHash,
      GIT_COMMIT_DATE: commitDate,
    };
  } catch (error) {
    console.warn("Warning: Could not get git information:", error.message);
    return {
      NEXT_PUBLIC_GIT_COMMIT_HASH: "unknown",
      NEXT_PUBLIC_GIT_COMMIT_DATE: "unknown",
      GIT_COMMIT_HASH: "unknown",
      GIT_COMMIT_DATE: "unknown",
    };
  }
}

function writeEnvFile(gitInfo, outputPath) {
  const envContent = Object.entries(gitInfo)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  fs.writeFileSync(outputPath, envContent);
  console.log(`Git info written to ${outputPath}`);
}

// Get git info
const gitInfo = getGitInfo();

// Write to .env.local for development
const envLocalPath = path.join(process.cwd(), ".env.local");
writeEnvFile(gitInfo, envLocalPath);

// Export for use in build scripts
export default gitInfo;
