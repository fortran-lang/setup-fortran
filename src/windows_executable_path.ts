export function normalizeWindowsExecutablePath(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/\.exe$/i, "")
    .toLowerCase();
}
