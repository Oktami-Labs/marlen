import { describe, expect, it } from "vitest";
import { initials, parseAddress, recipientNames, splitAddresses } from "@/lib/addresses";

/**
 * Every email surface names a person rather than an address, so this is what
 * decides whether a row reads "Sophie Wagner" or a raw mailbox string.
 */
describe("parseAddress", () => {
  it("prefers the display name the sender set", () => {
    expect(parseAddress("Petra Wagner <petra.wagner@example.com>")).toEqual({
      name: "Petra Wagner",
      address: "petra.wagner@example.com",
    });
    expect(parseAddress('"Wagner, Petra" <petra@example.com>').name).toBe("Wagner, Petra");
  });

  it("reads a name off the local part when there is no display name", () => {
    expect(parseAddress("sophie.wagner@example.com").name).toBe("Sophie Wagner");
    expect(parseAddress("t.berger@nordwind-logistik.de").name).toBe("T. Berger");
    expect(parseAddress("markus@example.se").name).toBe("Markus");
  });

  it("keeps the address itself when the local part is not a name", () => {
    expect(parseAddress("a2291@example.com").name).toBe("a2291@example.com");
    expect(parseAddress("noreply+bounce17@example.com").name).toBe("noreply+bounce17@example.com");
  });
});

describe("splitAddresses", () => {
  it("splits on commas that separate addresses, not on commas inside a name", () => {
    expect(splitAddresses('"Wagner, Petra" <petra@example.com>, markus@example.se')).toEqual([
      '"Wagner, Petra" <petra@example.com>',
      "markus@example.se",
    ]);
    expect(splitAddresses("")).toEqual([]);
  });
});

describe("recipientNames", () => {
  it("shows the user's own inbox as me, whatever case it is written in", () => {
    const names = recipientNames(
      ["Selin Kaya <Selin@Nordwind-Studio.de>", "t.brandt@acme-gmbh.de"],
      "selin@nordwind-studio.de",
      "me",
    );
    expect(names).toEqual(["me", "T. Brandt"]);
  });
});

describe("initials", () => {
  it("takes at most two letters, from a name or from an address", () => {
    expect(initials("Sophie Wagner")).toBe("SW");
    expect(initials("Markus")).toBe("M");
    expect(initials("t.brandt@acme-gmbh.de")).toBe("TB");
    expect(initials("")).toBe("?");
  });
});
