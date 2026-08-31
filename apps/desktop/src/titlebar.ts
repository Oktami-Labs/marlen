export const TITLEBAR_HEIGHT = 34;

export function titleBarMode(): "inset" | "native" {
  return process.platform === "darwin" ? "inset" : "native";
}
