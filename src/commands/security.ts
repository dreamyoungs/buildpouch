/** 신뢰된 build runner가 호출하는 취약점 검사 gate. */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadConfig } from "../config/load.js";
import { BuildPouchError } from "../errors.js";
import { parseTrustedSecurityPolicy, verifySecurity } from "../security/verify.js";

export const securityHelpText = `Usage:
  buildpouch security verify --config <path> --trusted-policy <path> --image <repository@sha256:digest> [--json]

The trusted runner must own the policy file, executable, image digest, and command invocation.
`;

export async function runSecurity(args: string[]): Promise<number> {
  if (args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
    process.stdout.write(securityHelpText);
    return 0;
  }
  if (args[0] !== "verify") {
    throw new BuildPouchError("INVALID_ARGUMENT", "Expected security verify.");
  }
  let config = "buildpouch.yaml";
  let trustedPolicy: string | undefined;
  let image: string | undefined;
  let json = false;
  for (let index = 1; index < args.length; index += 1) {
    const option = args[index];
    if (option === "--json") {
      json = true;
    } else if (["--config", "--trusted-policy", "--image"].includes(option ?? "")) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new BuildPouchError("INVALID_ARGUMENT", `${option} requires a value.`);
      }
      if (option === "--config") config = value;
      else if (option === "--trusted-policy") trustedPolicy = value;
      else image = value;
      index += 1;
    } else if (option === "--help" || option === "-h") {
      process.stdout.write(securityHelpText);
      return 0;
    } else {
      throw new BuildPouchError("INVALID_ARGUMENT", `Unknown security option: ${option ?? ""}.`);
    }
  }
  if (trustedPolicy === undefined || image === undefined) {
    throw new BuildPouchError("INVALID_ARGUMENT", "security verify requires --trusted-policy and --image.");
  }
  const loaded = await loadConfig(config);
  const policy = loaded.config.security?.vulnerabilityScan;
  if (policy === undefined) {
    throw new BuildPouchError("INVALID_CONFIGURATION", "security verify requires security.vulnerabilityScan in the configuration.");
  }
  let trustedSource: string;
  try {
    trustedSource = await readFile(resolve(trustedPolicy), "utf8");
  } catch {
    throw new BuildPouchError("INVALID_CONFIGURATION", "Unable to read trusted runner policy.");
  }
  const controller = new AbortController();
  const onSigint = (): void => controller.abort();
  const onSigterm = (): void => controller.abort();
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  try {
    const result = await verifySecurity(policy, parseTrustedSecurityPolicy(trustedSource), image, undefined, undefined, controller.signal);
    process.stdout.write(json ? `${JSON.stringify(result, null, 2)}\n` : `Security: ${result.status}\nImage: ${result.image}\n${result.reason === undefined ? "" : `Reason: ${result.reason}\n`}`);
    return 0;
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  }
}
