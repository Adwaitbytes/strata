import { parseConfig, type ApiConfig } from "../../src/config.js";

export function testConfig(env: Record<string, string> = {}): ApiConfig {
  return parseConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", ...env });
}
