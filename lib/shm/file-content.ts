/** Client-safe helpers for base64 / data-URI file payloads (no Node built-ins). */

export function stripDataUri(fileContent: string) {
  return String(fileContent || "").replace(/^data:[^;]+;base64,/, "");
}
