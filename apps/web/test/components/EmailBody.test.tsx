import i18n from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { initReactI18next } from "react-i18next";
import { beforeAll, describe, expect, it } from "vitest";
import { EmailBody } from "@/components/EmailBody";
import en from "@/locales/en.json";

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ lng: "en", resources: { en: { translation: en } } });
});

describe("EmailBody", () => {
  it("keeps the message inside a frame that cannot script the app or phone home", () => {
    const markup = renderToStaticMarkup(
      <EmailBody html={'<p>hallo</p><img src="https://track.test/pixel.gif">'} />,
    );

    expect(markup).toContain('sandbox="allow-scripts"');
    expect(markup).not.toContain("allow-same-origin");
    expect(markup).toContain("default-src");
    expect(markup).toMatch(/script-src &#x27;nonce-[0-9a-f-]{36}&#x27;/);
    expect(markup).toContain("&lt;p&gt;hallo&lt;/p&gt;");
    expect(markup).not.toContain("<p>hallo</p>");
  });

  it("blocks the sender's remote images until the reader asks for them", () => {
    const withPixel = renderToStaticMarkup(
      <EmailBody html={'<p>hallo</p><img src="https://track.test/pixel.gif">'} />,
    );
    expect(withPixel).toContain("img-src data:;");
    expect(withPixel).toContain("Load images");

    const plain = renderToStaticMarkup(<EmailBody html="<p>hallo</p>" />);
    expect(plain).not.toContain("Load images");
  });
});
