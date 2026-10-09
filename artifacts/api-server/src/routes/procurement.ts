import { Router, type IRouter } from "express";
import { and, avg, desc, eq, ilike, or, sql } from "drizzle-orm";
import {
  activityTable,
  criteriaTable,
  db,
  evaluationsTable,
  suppliersTable,
} from "@workspace/db";
import {
  CreateEvaluationResponse,
  CreateSupplierBody,
  CreateSupplierResponse,
  DeleteSupplierParams,
  GetActivityQueryParams,
  GetActivityResponse,
  GetCriteriaResponse,
  GetDashboardResponse,
  GetEvaluationParams,
  GetEvaluationResponse,
  GetEvaluationsResponse,
  GetSuppliersQueryParams,
  GetSuppliersResponse,
  SaveEvaluationAnchorBody,
  SaveEvaluationAnchorParams,
  SaveEvaluationAnchorResponse,
  UpdateCriteriaBody,
  UpdateCriteriaResponse,
  UpdateSupplierBody,
  UpdateSupplierParams,
  UpdateSupplierResponse,
} from "@workspace/api-zod";
import {
  DEFAULT_CRITERIA,
  evaluationSummary,
  fingerprintEvaluation,
  getRecentActivity,
  getRecentEvaluations,
  initializeProcurementWorkspace,
  logActivity,
  scoreSuppliers,
  supplierResponse,
  validateCriteria,
} from "../lib/procurement";

const router: IRouter = Router();

router.use(async (_req, _res, next) => {
  await initializeProcurementWorkspace();
  next();
});

router.get("/dashboard", async (_req, res) => {
  const [
    supplierRows,
    evaluationRows,
    anchoredRows,
    averageRows,
    recentEvaluations,
    recentActivity,
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(suppliersTable),
    db.select({ count: sql<number>`count(*)::int` }).from(evaluationsTable),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(evaluationsTable)
      .where(sql`${evaluationsTable.anchor} is not null`),
    db.select({ average: avg(evaluationsTable.winnerScore) }).from(evaluationsTable),
    getRecentEvaluations(5),
    getRecentActivity(6),
  ]);

  const data = GetDashboardResponse.parse({
    supplierCount: supplierRows[0]?.count ?? 0,
    evaluationCount: evaluationRows[0]?.count ?? 0,
    anchoredCount: anchoredRows[0]?.count ?? 0,
    averageWinnerScore:
      averageRows[0]?.average === null || averageRows[0]?.average === undefined
        ? null
        : Number(averageRows[0].average),
    recentEvaluations,
    recentActivity: recentActivity.map((entry) => ({
      ...entry,
      createdAt: entry.createdAt.toISOString(),
    })),
  });
  res.json(data);
});

router.get("/activity", async (req, res) => {
  const parsed = GetActivityQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid activity limit." });
    return;
  }

  const entries = await getRecentActivity(parsed.data.limit);
  res.json(
    GetActivityResponse.parse(
      entries.map((entry) => ({
        ...entry,
        createdAt: entry.createdAt.toISOString(),
      })),
    ),
  );
});

router.get("/suppliers", async (req, res) => {
  const parsed = GetSuppliersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid search query." });
    return;
  }

  const search = parsed.data.search?.trim();
  const where = search
    ? or(
        ilike(suppliersTable.name, `%${search}%`),
        ilike(suppliersTable.location, `%${search}%`),
        sql`${suppliersTable.certifications}::text ilike ${`%${search}%`}`,
      )
    : undefined;
  const rows = await db
    .select()
    .from(suppliersTable)
    .where(where)
    .orderBy(suppliersTable.id);
  res.json(GetSuppliersResponse.parse(rows.map(supplierResponse)));
});

router.post("/suppliers", async (req, res) => {
  const parsed = CreateSupplierBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Supplier details are invalid." });
    return;
  }

  const [created] = await db
    .insert(suppliersTable)
    .values(parsed.data)
    .returning();
  await logActivity("supplier_created", `${created.name} was added to the supplier directory.`);
  req.log.info({ supplierId: created.id }, "supplier created");
  res
    .status(201)
    .json(CreateSupplierResponse.parse(supplierResponse(created)));
});

router.patch("/suppliers/:id", async (req, res) => {
  const params = UpdateSupplierParams.safeParse(req.params);
  const body = UpdateSupplierBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Supplier update is invalid." });
    return;
  }

  const [updated] = await db
    .update(suppliersTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(eq(suppliersTable.id, params.data.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Supplier not found." });
    return;
  }

  await logActivity("supplier_updated", `${updated.name} was updated.`);
  req.log.info({ supplierId: updated.id }, "supplier updated");
  res.json(UpdateSupplierResponse.parse(supplierResponse(updated)));
});

router.delete("/suppliers/:id", async (req, res) => {
  const params = DeleteSupplierParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Supplier ID is invalid." });
    return;
  }

  const [deleted] = await db
    .delete(suppliersTable)
    .where(eq(suppliersTable.id, params.data.id))
    .returning({ id: suppliersTable.id, name: suppliersTable.name });
  if (!deleted) {
    res.status(404).json({ error: "Supplier not found." });
    return;
  }

  await logActivity("supplier_deleted", `${deleted.name} was removed from the supplier directory.`);
  req.log.info({ supplierId: deleted.id }, "supplier deleted");
  res.status(204).end();
});

router.get("/criteria", async (_req, res) => {
  const [criteria] = await db
    .select()
    .from(criteriaTable)
    .where(eq(criteriaTable.id, 1));
  res.json(
    GetCriteriaResponse.parse({
      criteria: criteria?.criteria ?? DEFAULT_CRITERIA,
      version: criteria?.version ?? 1,
      updatedAt: (criteria?.updatedAt ?? new Date()).toISOString(),
    }),
  );
});

router.put("/criteria", async (req, res) => {
  const parsed = UpdateCriteriaBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Evaluation criteria are invalid." });
    return;
  }
  const error = validateCriteria(parsed.data.criteria);
  if (error) {
    res.status(400).json({ error });
    return;
  }

  const [current] = await db
    .select()
    .from(criteriaTable)
    .where(eq(criteriaTable.id, 1));
  const nextVersion = (current?.version ?? 0) + 1;
  const [updated] = await db
    .insert(criteriaTable)
    .values({
      id: 1,
      version: nextVersion,
      criteria: parsed.data.criteria,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: criteriaTable.id,
      set: {
        version: nextVersion,
        criteria: parsed.data.criteria,
        updatedAt: new Date(),
      },
    })
    .returning();

  await logActivity("criteria_updated", `Evaluation rubric updated to version ${updated.version}.`);
  res.json(
    UpdateCriteriaResponse.parse({
      criteria: updated.criteria,
      version: updated.version,
      updatedAt: updated.updatedAt.toISOString(),
    }),
  );
});

router.get("/evaluations", async (_req, res) => {
  const rows = await db
    .select()
    .from(evaluationsTable)
    .orderBy(desc(evaluationsTable.createdAt));
  res.json(GetEvaluationsResponse.parse(rows.map(evaluationSummary)));
});

router.post("/evaluations", async (req, res) => {
  const [criteriaRow] = await db
    .select()
    .from(criteriaTable)
    .where(eq(criteriaTable.id, 1));
  const criteria = criteriaRow?.criteria ?? DEFAULT_CRITERIA;
  const criteriaError = validateCriteria(criteria);
  if (criteriaError) {
    res.status(400).json({ error: criteriaError });
    return;
  }

  const suppliers = await db.select().from(suppliersTable);
  if (suppliers.length === 0) {
    res
      .status(400)
      .json({ error: "Add at least one supplier before running an evaluation." });
    return;
  }

  const { ranked, disqualified } = scoreSuppliers(suppliers, criteria);
  const winner = ranked[0] ?? null;
  const [created] = await db
    .insert(evaluationsTable)
    .values({
      winnerName: winner?.name ?? null,
      winnerScore: winner?.score ?? null,
      supplierCount: suppliers.length,
      qualifiedCount: ranked.length,
      criteriaCount: criteria.filter((rule) => rule.enabled).length,
      criteriaSnapshot: criteria,
      ranked,
      disqualified,
      anchor: null,
    })
    .returning();

  await logActivity(
    "evaluation_created",
    winner
      ? `Evaluation #${created.id} ranked ${winner.name} first at ${winner.score.toFixed(1)}.`
      : `Evaluation #${created.id} completed with no qualifying supplier.`,
    created.id,
  );
  req.log.info({ evaluationId: created.id, supplierCount: suppliers.length }, "evaluation created");
  res.status(201).json(
    CreateEvaluationResponse.parse({
      ...evaluationSummary(created),
      criteriaSnapshot: created.criteriaSnapshot,
      ranked: created.ranked,
      disqualified: created.disqualified,
    }),
  );
});

router.get("/evaluations/:id", async (req, res) => {
  const params = GetEvaluationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Evaluation ID is invalid." });
    return;
  }
  const [evaluation] = await db
    .select()
    .from(evaluationsTable)
    .where(eq(evaluationsTable.id, params.data.id));
  if (!evaluation) {
    res.status(404).json({ error: "Evaluation not found." });
    return;
  }
  res.json(
    GetEvaluationResponse.parse({
      ...evaluationSummary(evaluation),
      criteriaSnapshot: evaluation.criteriaSnapshot,
      ranked: evaluation.ranked,
      disqualified: evaluation.disqualified,
    }),
  );
});

router.patch("/evaluations/:id/anchor", async (req, res) => {
  const params = SaveEvaluationAnchorParams.safeParse(req.params);
  const body = SaveEvaluationAnchorBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Anchor details are invalid." });
    return;
  }
  const [evaluation] = await db
    .select()
    .from(evaluationsTable)
    .where(eq(evaluationsTable.id, params.data.id));
  if (!evaluation) {
    res.status(404).json({ error: "Evaluation not found." });
    return;
  }
  if (evaluation.anchor) {
    res.status(400).json({ error: "This evaluation already has an on-chain anchor." });
    return;
  }

  const expectedHash = fingerprintEvaluation(evaluation, body.data.verificationSalt);
  if (expectedHash.toLowerCase() !== body.data.reportHash.toLowerCase()) {
    res
      .status(400)
      .json({ error: "The report hash does not match this saved evaluation." });
    return;
  }

  const anchor = {
    ...body.data,
    anchoredAt: new Date().toISOString(),
  };
  const [updated] = await db
    .update(evaluationsTable)
    .set({ anchor })
    .where(and(eq(evaluationsTable.id, evaluation.id), sql`${evaluationsTable.anchor} is null`))
    .returning();
  if (!updated) {
    res.status(400).json({ error: "This evaluation already has an on-chain anchor." });
    return;
  }

  await logActivity(
    "evaluation_anchored",
    `Evaluation #${evaluation.id} was anchored on chain ${anchor.chainId}.`,
    evaluation.id,
  );
  req.log.info({ evaluationId: evaluation.id, transactionHash: anchor.transactionHash }, "evaluation anchored");
  res.json(
    SaveEvaluationAnchorResponse.parse({
      ...evaluationSummary(updated),
      criteriaSnapshot: updated.criteriaSnapshot,
      ranked: updated.ranked,
      disqualified: updated.disqualified,
    }),
  );
});

export default router;
