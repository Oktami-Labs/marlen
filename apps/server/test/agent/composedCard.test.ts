import { describe, expect, it } from "vitest";
import { parseAgentCard } from "../../src/agent/cards.js";
import { composeCardTool } from "../../src/agent/composedCardTool.js";

function resultText(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.map((part) => part.text ?? "").join("");
}

describe("agent-composed cards", () => {
  it("round-trips the approved layout vocabulary through the agent tool boundary", async () => {
    const result = await composeCardTool.execute("compose-1", {
      title: "Launch readiness",
      fallback: "The launch is 78% ready; approval and the print date remain open.",
      blocks: [
        {
          kind: "metrics",
          items: [
            { label: "Ready", value: "78%", detail: "+12% this week", tone: "success" },
            { label: "Open", value: "2", tone: "warning" },
          ],
        },
        { kind: "markdown", content: "**Next bottleneck:** packaging approval." },
        {
          kind: "key_value",
          items: [
            { label: "Owner", value: "Elif" },
            { label: "Deadline", value: "Thursday" },
          ],
        },
        {
          kind: "list",
          ordered: true,
          items: [
            { title: "Approve packaging", tone: "warning" },
            { title: "Confirm print date", detail: "Quote received" },
          ],
        },
        {
          kind: "table",
          columns: ["Vendor", "Price"],
          rows: [
            ["Norddruck", "€3,480"],
            ["Printwerk", "€3,250"],
          ],
        },
        {
          kind: "chart",
          chartType: "bar",
          title: "Price",
          unit: "€",
          points: [
            { label: "Norddruck", value: 3480, tone: "accent" },
            { label: "Printwerk", value: 3250, tone: "success" },
          ],
        },
      ],
      actions: [
        { kind: "reply", label: "Follow up", message: "Draft a follow-up to Elif." },
        { kind: "open_url", label: "Open project", url: "https://example.com/project" },
      ],
    });

    const card = parseAgentCard(result.details);
    expect(card).toMatchObject({
      kind: "composed",
      version: 1,
      title: "Launch readiness",
      blocks: [
        { kind: "metrics" },
        { kind: "markdown" },
        { kind: "key_value" },
        { kind: "list", ordered: true },
        {
          kind: "table",
          rows: [
            ["Norddruck", "€3,480"],
            ["Printwerk", "€3,250"],
          ],
        },
        { kind: "chart", chartType: "bar" },
      ],
      actions: [
        { kind: "reply", message: "Draft a follow-up to Elif." },
        { kind: "open_url", url: "https://example.com/project" },
      ],
    });
    expect(resultText(result)).toContain("Launch readiness");
  });

  it("rejects unsafe actions and malformed stored layouts", async () => {
    const result = await composeCardTool.execute("compose-2", {
      title: "Unsafe",
      fallback: "Unsafe link",
      blocks: [{ kind: "markdown", content: "Open it." }],
      actions: [{ kind: "open_url", label: "Run", url: "javascript:alert(1)" }],
    });

    expect(result.details).toBeUndefined();
    expect(resultText(result)).toContain("Invalid compose_card parameters");
    expect(
      parseAgentCard({
        kind: "composed",
        version: 1,
        title: "Unsafe stored action",
        fallback: "Unsafe link",
        blocks: [{ kind: "markdown", content: "Open it." }],
        actions: [{ kind: "open_url", label: "Run", url: "javascript:alert(1)" }],
      }),
    ).toBeUndefined();
    expect(
      parseAgentCard({
        kind: "composed",
        version: 1,
        title: "Broken table",
        fallback: "The row does not match the columns.",
        blocks: [{ kind: "table", columns: ["A", "B"], rows: [["only A"]] }],
      }),
    ).toBeUndefined();
  });
});
