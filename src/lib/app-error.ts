export interface InvokeAppError {
  code: string;
  message: string;
}

export function isInvokeAppError(error: unknown): error is InvokeAppError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    "message" in error &&
    typeof error.message === "string"
  );
}

export function invokeErrorMessage(error: unknown): string {
  return isInvokeAppError(error) ? error.message : String(error);
}
