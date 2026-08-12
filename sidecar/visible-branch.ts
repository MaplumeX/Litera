export function visibleMessageEntries<T extends { type: string; message?: { role?: string } }>(
  branch: readonly T[],
): T[] {
  return branch.filter((entry) => {
    if (entry.type !== "message") return false;
    const role = entry.message?.role;
    return role === "user" || role === "assistant";
  });
}
