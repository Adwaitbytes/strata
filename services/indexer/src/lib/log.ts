/** Structured JSON logs to stdout/stderr. Never pass secrets or DB URLs here. */
type Level = "info" | "warn" | "error";

export function log(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields });
  if (level === "info") process.stdout.write(`${line}\n`);
  else process.stderr.write(`${line}\n`);
}

export function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 500);
  return String(err).slice(0, 500);
}
