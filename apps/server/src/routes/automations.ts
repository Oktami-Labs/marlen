import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { Automation, RunStep, RunTrigger } from "@marlen/shared";
import { Type } from "@sinclair/typebox";
import { and, asc, desc, eq, isNull, ne, or, sql } from "drizzle-orm";
import { parseStoredCards } from "../agent/cards.js";
import { notFound, requireRow } from "../core/errors.js";
import { db, schema } from "../db/index.js";
import { likeContains, likePattern } from "../db/like.js";
import {
  createAutomation,
  deleteAutomation,
  updateAutomation,
} from "../services/automations/manage.js";
import { handleReportItem } from "../services/automations/reportState.js";
import { runSteps } from "../services/automations/runProgress.js";
import {
  findMissedAutomations,
  getNextRunAt,
  runAutomation,
  runMissedAutomations,
} from "../services/automations/scheduler.js";

const runsQuery = Type.Object({
  q: Type.Optional(Type.String()),
  limit: Type.Optional(Type.Integer({ minimum: 1 })),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
});

const idParams = Type.Object({ id: Type.String() });

const reportItemBody = Type.Object({ key: Type.String({ minLength: 1 }) });

const automationBody = Type.Object({
  name: Type.String(),
  instruction: Type.String(),
  /** Empty or omitted = manual-only: runs only on demand. */
  schedule: Type.Optional(Type.String()),
  enabled: Type.Optional(Type.Boolean()),
  showInActivity: Type.Optional(Type.Boolean()),
  pinned: Type.Optional(Type.Boolean()),
  runOnNewMail: Type.Optional(Type.Boolean()),
  notifyOnCompletion: Type.Optional(Type.Boolean()),
  leadId: Type.Optional(Type.String()),
});

const automationPatchBody = Type.Object({
  name: Type.Optional(Type.String()),
  instruction: Type.Optional(Type.String()),
  schedule: Type.Optional(Type.String()),
  enabled: Type.Optional(Type.Boolean()),
  showInActivity: Type.Optional(Type.Boolean()),
  pinned: Type.Optional(Type.Boolean()),
  runOnNewMail: Type.Optional(Type.Boolean()),
  notifyOnCompletion: Type.Optional(Type.Boolean()),
  position: Type.Optional(Type.Number()),
});

const runToAutomation = eq(schema.automations.id, schema.automationRuns.automationId);

// leftJoin keeps a run whose automation was deleted, with a null automationName.
function runsSelectBase() {
  return db
    .select({
      id: schema.automationRuns.id,
      automationId: schema.automationRuns.automationId,
      conversationId: schema.automationRuns.conversationId,
      status: schema.automationRuns.status,
      result: schema.automationRuns.result,
      cards: schema.automationRuns.cards,
      trigger: schema.automationRuns.trigger,
      startedAt: schema.automationRuns.startedAt,
      finishedAt: schema.automationRuns.finishedAt,
      automationName: schema.automations.name,
    })
    .from(schema.automationRuns)
    .leftJoin(schema.automations, runToAutomation);
}

function toRunDto<
  T extends { id: string; status: string; cards: string | null; trigger: string | null },
>(
  row: T,
): Omit<T, "cards" | "trigger"> & {
  cards: ReturnType<typeof parseStoredCards>;
  trigger: RunTrigger | null;
  steps?: RunStep[];
} {
  const { cards, trigger, ...rest } = row;
  return {
    ...rest,
    cards: parseStoredCards(cards),
    trigger: trigger ? (JSON.parse(trigger) as RunTrigger) : null,
    // Only a run in flight has a trail; a finished one is described by its result.
    steps: row.status === "running" ? runSteps(row.id) : undefined,
  };
}

async function latestRun(automationId: string): Promise<Automation["lastRun"]> {
  const [run] = await db
    .select({
      id: schema.automationRuns.id,
      status: schema.automationRuns.status,
      startedAt: schema.automationRuns.startedAt,
    })
    .from(schema.automationRuns)
    .where(eq(schema.automationRuns.automationId, automationId))
    .orderBy(desc(schema.automationRuns.startedAt))
    .limit(1);
  return run ?? null;
}

export const automationRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get("/api/automations", async (): Promise<Automation[]> => {
    const rows = await db
      .select()
      .from(schema.automations)
      .orderBy(asc(schema.automations.position), desc(schema.automations.createdAt));
    return Promise.all(
      rows.map(async (row) => ({
        ...row,
        nextRunAt: getNextRunAt(row.id),
        lastRun: await latestRun(row.id),
      })),
    );
  });

  app.get("/api/runs", { schema: { querystring: runsQuery } }, async (req) => {
    const q = req.query.q?.trim();
    const limit = Math.min(req.query.limit ?? 30, 100);
    const offset = req.query.offset ?? 0;

    // isNull keeps both the unset default and a deleted automation's NULL rows.
    const visible = or(
      isNull(schema.automations.showInActivity),
      eq(schema.automations.showInActivity, true),
    );
    // SQLite LIKE is case-insensitive for ASCII, which covers this digest text.
    const pattern = q ? likeContains(q) : undefined;
    const where = pattern
      ? and(
          visible,
          or(
            likePattern(schema.automationRuns.result, pattern),
            likePattern(schema.automationRuns.cards, pattern),
            likePattern(schema.automations.name, pattern),
          ),
        )
      : visible;

    const rows = await runsSelectBase()
      .where(where)
      .orderBy(desc(schema.automationRuns.startedAt))
      .limit(limit)
      .offset(offset);
    const items = rows.map(toRunDto);

    const totalQuery = db
      .select({ count: sql<number>`count(*)` })
      .from(schema.automationRuns)
      .leftJoin(schema.automations, runToAutomation);
    const [totalRow] = await totalQuery.where(where);

    return { items, total: Number(totalRow?.count ?? 0) };
  });

  // Deliberately bypasses both /api/runs filters: pinning overrides showInActivity,
  // and there is no pagination limit, so an old pinned run never falls out of view.
  app.get("/api/runs/pinned", async () => {
    const [automation] = await db
      .select()
      .from(schema.automations)
      .where(eq(schema.automations.pinned, true));
    if (!automation) return { run: null, automation: null };

    const [run] = await runsSelectBase()
      .where(
        and(
          eq(schema.automationRuns.automationId, automation.id),
          eq(schema.automationRuns.status, "success"),
          ne(schema.automationRuns.result, ""),
        ),
      )
      .orderBy(desc(schema.automationRuns.startedAt))
      .limit(1);

    return {
      run: run ? toRunDto(run) : null,
      automation: { ...automation, nextRunAt: getNextRunAt(automation.id) },
    };
  });

  app.get("/api/runs/missed", async () => {
    return { items: await findMissedAutomations() };
  });

  app.post("/api/runs/catch-up", async () => {
    const started = await runMissedAutomations();
    return { started };
  });

  app.post(
    "/api/runs/:id/report-items/handled",
    { schema: { params: idParams, body: reportItemBody } },
    async (req) => {
      const handled = await handleReportItem(req.params.id, req.body.key);
      if (!handled) throw notFound("no report item with this key");
      return { ok: true };
    },
  );

  app.post("/api/automations", { schema: { body: automationBody } }, async (req) => {
    return createAutomation(req.body);
  });

  app.patch(
    "/api/automations/:id",
    { schema: { params: idParams, body: automationPatchBody } },
    async (req) => {
      return updateAutomation(req.params.id, req.body);
    },
  );

  app.delete("/api/automations/:id", { schema: { params: idParams } }, async (req) => {
    const deleted = await deleteAutomation(req.params.id);
    if (!deleted) throw notFound("no automation with this id");
    return { ok: true };
  });

  app.post("/api/automations/:id/run", { schema: { params: idParams } }, async (req) => {
    await requireRow(
      db
        .select({ id: schema.automations.id })
        .from(schema.automations)
        .where(eq(schema.automations.id, req.params.id)),
      "not found",
    );
    // Fire and forget; the UI polls the runs list.
    runAutomation(req.params.id, { manual: true }).catch((error) =>
      req.log.error(error, `manual run of ${req.params.id} failed`),
    );
    return { ok: true };
  });

  app.get("/api/automations/:id/runs", { schema: { params: idParams } }, async (req) => {
    const rows = await db
      .select()
      .from(schema.automationRuns)
      .where(eq(schema.automationRuns.automationId, req.params.id))
      .orderBy(desc(schema.automationRuns.startedAt))
      .limit(20);
    return rows.map(toRunDto);
  });
};
