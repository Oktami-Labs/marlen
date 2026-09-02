import type { Page } from "@playwright/test";

/** A square gradient PNG drawn in the page, for file inputs that want a picture. */
export async function gradientPng(
  page: Page,
): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
  const dataUri = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 320;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas unavailable");
    const gradient = context.createLinearGradient(0, 0, 320, 320);
    gradient.addColorStop(0, "#7c5cff");
    gradient.addColorStop(1, "#ff8a5c");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 320, 320);
    return canvas.toDataURL("image/png");
  });
  return {
    name: "picture.png",
    mimeType: "image/png",
    buffer: Buffer.from(dataUri.slice(dataUri.indexOf(",") + 1), "base64"),
  };
}
