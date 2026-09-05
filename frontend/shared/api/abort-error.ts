/**
 * Browser APIs, test doubles, and request wrappers can surface aborts as
 * different Error subclasses. The stable contract is the platform error name.
 */
export function isAbortError(reason: unknown): boolean {
  return (
    typeof reason === "object" &&
    reason !== null &&
    "name" in reason &&
    reason.name === "AbortError"
  );
}
