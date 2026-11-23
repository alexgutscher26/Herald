/** A failure that retrying cannot fix (bad payload, disabled feature, missing data). */
export class NonRetryableJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableJobError";
  }
}
