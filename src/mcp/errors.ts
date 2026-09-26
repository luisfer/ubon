/** A tool argument the server rejects (bad path, path outside the workspace). Returned as a tool error, not a protocol error. */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolInputError';
  }
}
