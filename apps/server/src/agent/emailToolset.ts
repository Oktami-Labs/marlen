import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AccountPermissions, AccountSignature, ConnectedAccount } from "@marlen/shared";
import type { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { moduleLogger } from "../core/logger.js";
import { getAccountPermissions, getAccountSignatures } from "../db/settings.js";
import { getAttachmentProvider } from "../email/attachmentProviders.js";
import { getDraftProvider } from "../email/providers.js";
import { getMailReadProvider } from "../email/read/readProviders.js";
import {
  type ConnectConfig,
  getConnectConfig,
  getPipedreamAccessToken,
  listAccounts,
} from "../integrations/pipedream/connect.js";
import {
  callWithRevival,
  connectForAccount,
  type McpSession,
  type McpSessionBox,
} from "../integrations/pipedream/mcpSession.js";
import { isWhatsAppLinked } from "../integrations/whatsapp/session.js";
import { buildListAttachmentsTool, buildSaveAttachmentTool } from "./attachmentTool.js";
import { buildDraftTool, buildUpdateDraftTool } from "./draftTools.js";
import {
  type ActionGrants,
  isSubstitutedSendAction,
  NO_GRANTS,
  registeredCategory,
  sessionGrants,
} from "./toolAccess.js";
import { clampToolText } from "./toolkit.js";

const log = moduleLogger("emailToolset");

function sanitizeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 128);
}

function accountSlug(account: ConnectedAccount): string {
  const local = account.name.split("@")[0] ?? account.name;
  const slug = local
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 24)
    .toLowerCase();
  return slug || account.id.replace(/[^a-zA-Z0-9]/g, "").slice(-6);
}

/** Fall back to the account id rather than assigning a colliding tool name. */
function claimLocalToolName(
  base: string,
  suffix: string,
  account: ConnectedAccount,
  seenNames: Set<string>,
): string | null {
  let name = sanitizeToolName(`${base}${suffix}`);
  if (seenNames.has(name)) name = sanitizeToolName(`${base}__${account.id}`);
  if (seenNames.has(name)) return null;
  seenNames.add(name);
  return name;
}

const MCP_TRUNCATION_HINT =
  "Ask for less and retry — a smaller max-results/limit, a narrower date range, or a more " +
  "specific query — then read individual records by id.";

function mcpContentToText(content: unknown): string {
  if (!Array.isArray(content)) return JSON.stringify(content ?? "");
  return content
    .map((block) => {
      if (block && typeof block === "object" && "type" in block) {
        const b = block as { type: string; text?: string };
        if (b.type === "text" && typeof b.text === "string") return b.text;
      }
      return JSON.stringify(block);
    })
    .join("\n");
}

type McpToolInfo = Awaited<ReturnType<McpClient["listTools"]>>["tools"][number];

interface AccountConnectResult {
  account: ConnectedAccount;
  session: McpSession | null;
  mcpTools: McpToolInfo[] | null;
}

interface AccountTools {
  tools: AgentTool[];
  readTools: AgentTool[];
}

/** Message/thread reads replaced by the normalized local mail_search/mail_thread pair. */
const SUBSTITUTED_MAIL_READ_ACTION =
  /^(?:find|get|list|search|fetch|retrieve)-(?:email|emails|message|messages|thread|threads)(?:-|$)/;

function isSubstitutedMailReadAction(mcpToolName: string): boolean {
  const action = mcpToolName.replace(/^[a-z0-9_]+-/, "");
  return SUBSTITUTED_MAIL_READ_ACTION.test(action);
}

function buildAccountTools(
  mcpTools: McpToolInfo[],
  box: McpSessionBox,
  config: ConnectConfig,
  account: ConnectedAccount,
  needsSuffix: boolean,
  seenNames: Set<string>,
  granted: ActionGrants,
  substituteMailReads: boolean,
): AccountTools {
  const tools: AgentTool[] = [];
  const readTools: AgentTool[] = [];
  const suffix = needsSuffix ? `__${accountSlug(account)}` : "";
  const skipped: string[] = [];

  const draftProvider = getDraftProvider(account.app);
  for (const mcpTool of mcpTools) {
    if (substituteMailReads && isSubstitutedMailReadAction(mcpTool.name)) {
      skipped.push(mcpTool.name);
      continue;
    }
    // Use the provider-generic local draft path when the account supports it.
    if (draftProvider && mcpTool.name === `${account.app}-create-draft`) continue;
    // Direct send actions bypass signatures and draft composition.
    if (draftProvider?.sendDraft && isSubstitutedSendAction(mcpTool.name)) {
      skipped.push(mcpTool.name);
      continue;
    }
    const category = registeredCategory(mcpTool.name, granted);
    if (!category) {
      skipped.push(mcpTool.name);
      continue;
    }
    const isRead = category === "read";
    let name = sanitizeToolName(`${mcpTool.name}${suffix}`);
    if (seenNames.has(name)) name = sanitizeToolName(`${mcpTool.name}__${account.id}`);
    if (seenNames.has(name)) continue;
    seenNames.add(name);

    const wrapped: AgentTool = {
      name,
      label: mcpTool.title ?? mcpTool.name,
      description: `${mcpTool.description ?? mcpTool.name}\n\nActs as the connected account: ${account.name}.`,
      parameters: mcpTool.inputSchema as AgentTool["parameters"],
      execute: async (_toolCallId, params, signal) => {
        // Never replay a write whose result is unknown.
        const result = await callWithRevival(
          box,
          account,
          config,
          mcpTool.name,
          (params ?? {}) as Record<string, unknown>,
          isRead,
          signal,
        );
        const text = clampToolText(mcpContentToText(result.content), MCP_TRUNCATION_HINT);
        if (result.isError) {
          throw new Error(text || `Tool ${mcpTool.name} failed`);
        }
        return { content: [{ type: "text", text }], details: undefined };
      },
    };
    tools.push(wrapped);
    if (isRead) readTools.push(wrapped);
  }
  log.debug(
    {
      app: account.app,
      account: account.name,
      reads: readTools.length,
      total: tools.length,
      ...(skipped.length > 0 ? { skipped } : {}),
    },
    "registered MCP tools",
  );
  return { tools, readTools };
}

export interface EmailToolset {
  tools: AgentTool[];
  readTools: AgentTool[];
  close: () => Promise<void>;
}

export interface LoadEmailToolsOptions {
  /** Interactive sessions propose drafts; unattended sessions write them. */
  interactive?: boolean;
}

const EMPTY_TOOLSET: EmailToolset = { tools: [], readTools: [], close: async () => {} };

export async function loadEmailTools(options: LoadEmailToolsOptions = {}): Promise<EmailToolset> {
  const interactive = options.interactive ?? true;
  const config = await getConnectConfig();
  if (!config) return EMPTY_TOOLSET;

  let accounts: ConnectedAccount[];
  let permissions: AccountPermissions[];
  let signatures: AccountSignature[];
  try {
    [accounts, , permissions, signatures] = await Promise.all([
      listAccounts(),
      // Fail bad credentials once before opening per-account sessions.
      getPipedreamAccessToken(),
      getAccountPermissions(),
      getAccountSignatures(),
    ]);
  } catch (error) {
    log.warn({ err: error }, "listing Pipedream accounts failed");
    return EMPTY_TOOLSET;
  }
  // Personal WhatsApp takes precedence over the Business transport.
  if (isWhatsAppLinked()) {
    accounts = accounts.filter((account) => account.app !== "whatsapp_business");
  }
  if (accounts.length === 0) return EMPTY_TOOLSET;

  const grantsById = new Map(
    permissions.map((p) => [p.accountId, sessionGrants(p, interactive)] as const),
  );
  const grantsFor = (accountId: string): ActionGrants => grantsById.get(accountId) ?? NO_GRANTS;

  const signedIds = new Set(signatures.map((s) => s.accountId));

  const perApp = new Map<string, number>();
  for (const account of accounts) perApp.set(account.app, (perApp.get(account.app) ?? 0) + 1);

  // Connect in parallel, then assign names in deterministic account order.
  const connectResults = await Promise.all(
    accounts.map(async (account): Promise<AccountConnectResult> => {
      let session: McpSession;
      try {
        session = await connectForAccount(account, config);
      } catch (error) {
        log.warn(
          { err: error, app: account.app, account: account.name },
          "MCP session failed for account",
        );
        return { account, session: null, mcpTools: null };
      }
      try {
        const { tools: mcpTools } = await session.client.listTools();
        return { account, session, mcpTools };
      } catch (error) {
        log.warn(
          { err: error, app: account.app, account: account.name },
          "listing tools failed for account",
        );
        return { account, session, mcpTools: null };
      }
    }),
  );

  const boxes: McpSessionBox[] = [];
  const tools: AgentTool[] = [];
  const readTools: AgentTool[] = [];
  const seenNames = new Set<string>();

  for (const { account, session, mcpTools } of connectResults) {
    let box: McpSessionBox | undefined;
    if (session) {
      box = { current: session, closed: false };
      boxes.push(box);
    }
    const needsSuffix = (perApp.get(account.app) ?? 0) > 1;
    if (box && mcpTools) {
      try {
        const accountTools = buildAccountTools(
          mcpTools,
          box,
          config,
          account,
          needsSuffix,
          seenNames,
          grantsFor(account.id),
          Boolean(getMailReadProvider(account.app)),
        );
        tools.push(...accountTools.tools);
        readTools.push(...accountTools.readTools);
      } catch (error) {
        log.warn(
          { err: error, app: account.app, account: account.name },
          "building tools failed for account",
        );
      }
    }
    const suffix = needsSuffix ? `__${accountSlug(account)}` : "";
    const draftProvider = getDraftProvider(account.app);
    if (draftProvider) {
      // Draft tools are excluded from the delegate worker subset.
      const name = claimLocalToolName(`${account.app}-create-draft`, suffix, account, seenNames);
      if (name)
        tools.push(
          buildDraftTool(
            account,
            name,
            draftProvider,
            grantsFor(account.id).send,
            signedIds.has(account.id),
            interactive,
          ),
        );
      if (draftProvider.updateDraft) {
        const updateName = claimLocalToolName(
          `${account.app}-update-draft`,
          suffix,
          account,
          seenNames,
        );
        if (updateName)
          tools.push(
            buildUpdateDraftTool(
              account,
              updateName,
              draftProvider.updateDraft,
              signedIds.has(account.id),
            ),
          );
      }
    }
    const attachmentProvider = getAttachmentProvider(account.app);
    if (attachmentProvider) {
      // Local library writes do not require mailbox write permission.
      const name = claimLocalToolName(`${account.app}-save-attachment`, suffix, account, seenNames);
      if (name) tools.push(buildSaveAttachmentTool(account, name, attachmentProvider));
      const listName = claimLocalToolName(
        `${account.app}-list-attachments`,
        suffix,
        account,
        seenNames,
      );
      if (listName) tools.push(buildListAttachmentsTool(account, listName, attachmentProvider));
    }
  }

  return {
    tools,
    readTools,
    close: async () => {
      // Prevent in-flight reconnects from reopening disposed sessions.
      await Promise.all(
        boxes.map(async (box) => {
          box.closed = true;
          await box.current.close();
        }),
      );
    },
  };
}
