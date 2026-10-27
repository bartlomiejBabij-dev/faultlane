/** Only controlled, non-secret diagnostics may cross the CLI error boundary. */
export class CliInputError extends Error {}
