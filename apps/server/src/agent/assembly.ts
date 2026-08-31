import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "@marlen/shared";
import { moduleLogger } from "../core/logger.js";
import { loadOnOfficeTools } from "../integrations/onoffice/tools.js";
import { buildWhatsAppTools } from "../integrations/whatsapp/tools.js";
import { appHelpTool } from "./appHelpTool.js";
import { automationManageTools, automationReadTools } from "./automationTools.js";
import { composeBriefingTool } from "./briefingTool.js";
import type { SessionCapabilities } from "./capabilities.js";
import { presentChartTool } from "./chartTool.js";
import { presentChoicesTool } from "./choicesTool.js";
import { compactedMessages } from "./compaction.js";
import { buildDelegateTool } from "./delegate.js";
import { keepDraftTool, listDraftsTool } from "./draftTools.js";
import type { EmailToolset } from "./emailToolset.js";
import { buildFileTools } from "./fileTools.js";
import { presentFormTool } from "./formTool.js";
import { recordCompactionMarker } from "./history.js";
import { leadDeleteTool, leadTools } from "./leadTools.js";
import { getThinkingLevel, resolveActiveModel } from "./llm/registry.js";
import { streamViaModelRegistry } from "./oneShot.js";
import { buildSystemPrompt } from "./prompt.js";
import { buildTodoTools } from "./todoTools.js";
import { voiceLearnTool } from "./voiceLearn.js";
import { webFetchTool } from "./webFetchTool.js";
import { webSearchTool } from "./webSearchTool.js";
import { buildWikiReadTools, buildWikiTools } from "./wikiTools.js";

const log = moduleLogger("assembly");

async function resolveThinkingLevel(model: { reasoning: boolean }): Promise<ThinkingLevel> {
  return model.reasoning ? getThinkingLevel() : "off";
}

function toolSchemaChars(tools: AgentTool[]): number {
  let chars = 0;
  for (const tool of tools) {
    chars += tool.name.length + tool.description.length + JSON.stringify(tool.parameters).length;
  }
  return chars;
}

export async function buildAgent(
  toolset: EmailToolset,
  history: Message[],
  caps: SessionCapabilities,
  sessionId?: string,
): Promise<Agent> {
  const model = await resolveActiveModel();
  const onOfficeTools = await loadOnOfficeTools({
    allowWrites: caps.onOffice.writes,
    allowCreates: caps.onOffice.creates,
  });
  const whatsappTools = caps.whatsapp.linked
    ? buildWhatsAppTools(caps.whatsapp.mirror, sessionId)
    : [];
  // Unattended sessions never receive whole-filesystem grants.
  const fileTools = await buildFileTools(caps.interactive);
  const systemPrompt = await buildSystemPrompt(caps);
  const agent = new Agent({
    initialState: {
      systemPrompt,
      model,
      thinkingLevel: await resolveThinkingLevel(model),
      tools: [
        listDraftsTool,
        ...(caps.interactive ? [keepDraftTool] : []),
        ...toolset.tools,
        ...onOfficeTools,
        ...whatsappTools,
        ...fileTools,
        webSearchTool,
        webFetchTool,
        // Unattended mail cannot persist content into later prompts.
        ...(caps.interactive ? buildWikiTools() : buildWikiReadTools()),
        appHelpTool,
        // Unattended content cannot create or alter standing prompts.
        ...(caps.interactive ? automationManageTools : []),
        ...automationReadTools,
        // Lead deletion stays interactive because it cascades to automations.
        ...(caps.onOffice.configured ? leadTools : []),
        ...(caps.onOffice.configured && caps.interactive ? [leadDeleteTool] : []),
        ...buildTodoTools(sessionId),
        buildDelegateTool(toolset.readTools),
        ...(caps.interactive ? [voiceLearnTool] : []),
        composeBriefingTool,
        ...(caps.interactive ? [presentChoicesTool, presentFormTool] : []),
        ...(caps.interactive ? [presentChartTool] : []),
      ],
      messages: history,
    },
    streamFn: streamViaModelRegistry,
    sessionId,
  });
  // Prompt and tool definitions are the fixed context compaction cannot trim.
  log.info(
    {
      tools: agent.state.tools.length,
      promptTokens: Math.ceil(systemPrompt.length / 4),
      toolTokens: Math.ceil(toolSchemaChars(agent.state.tools) / 4),
      contextWindow: model.contextWindow,
    },
    "agent session built",
  );

  // Compact between tool calls as well as before a prompt.
  agent.prepareNextTurnWithContext = async ({ context }, signal) => {
    const compacted = await compactedMessages(
      {
        systemPrompt: context.systemPrompt,
        model: agent.state.model,
        messages: context.messages,
      },
      undefined,
      { signal },
    );
    if (!compacted) return undefined;
    agent.state.messages = compacted;
    if (sessionId) {
      await recordCompactionMarker(sessionId, compacted).catch((err: unknown) => {
        log.warn({ err, conversationId: sessionId }, "persisting the compaction marker failed");
      });
    }
    return { context: { ...context, messages: compacted } };
  };
  return agent;
}
