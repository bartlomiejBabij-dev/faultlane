export class RunnerIssue extends Error {
  constructor(public readonly status: "FAIL" | "ERROR", public readonly code: string, message: string) { super(message); }
}
