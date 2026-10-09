import { createHash } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import {
  activityTable,
  criteriaTable,
  db,
  evaluationsTable,
  suppliersTable,
  workspaceStateTable,
} from "@workspace/db";
import type {
  ActivityType,
  CriterionKey,
  CriterionRuleRecord,
  EvaluationAnchorRecord,
  EvaluationRecord,
  Supplier,
  SupplierScoreRecord,
} from "@workspace/db";

export const DEFAULT_CRITERIA: CriterionRuleRecord[] = [
  {
    key: "price",
    label: "Price Competitiveness",
    enabled: true,
    weight: 25,
    cutoff: 0,
    hint: "Cost efficiency (10 means most competitive)",
  },
  {
    key: "quality",
    label: "Quality Standards",
    enabled: true,
    weight: 35,
    cutoff: 7,
    hint: "Defect rate, build quality, and durability",
  },
  {
    key: "delivery",
    label: "Delivery Lead Time",
    enabled: true,
    weight: 20,
    cutoff: 0,
    hint: "On-time delivery and shipping speed",
  },
  {
    key: "reliability",
    label: "Operational Reliability",
    enabled: true,
    weight: 20,
    cutoff: 0,
    hint: "Contract compliance and vendor stability",
  },
];

const SAMPLE_SUPPLIERS = [
  {
    name: "Meridian Components",
    location: "Chennai, India",
    certifications: ["ISO 9001", "ISO 14001"],
    price: 6,
    quality: 9,
    delivery: 8,
    reliability: 9,
  },
  {
    name: "Kaito Precision Works",
    location: "Osaka, Japan",
    certifications: ["ISO 9001", "IATF 16949"],
    price: 4,
    quality: 10,
    delivery: 7,
    reliability: 9,
  },
  {
    name: "Rhein Industrietechnik",
    location: "Stuttgart, Germany",
    certifications: ["ISO 9001", "ISO 45001"],
    price: 5,
    quality: 9,
    delivery: 9,
    reliability: 8,
  },
] satisfies Omit<Supplier, "id" | "createdAt" | "updatedAt">[];

let initialization: Promise<void> | undefined;

export function initializeProcurementWorkspace(): Promise<void> {
  if (!initialization) {
    initialization = db.transaction(async (tx) => {
      await tx.insert(workspaceStateTable).values({ id: 1 }).onConflictDoNothing();
      await tx
        .insert(criteriaTable)
        .values({ id: 1, version: 1, criteria: DEFAULT_CRITERIA })
        .onConflictDoNothing();

      const [state] = await tx
        .select()
        .from(workspaceStateTable)
        .where(eq(workspaceStateTable.id, 1))
        .for("update");

      if (state && !state.sampleDataSeeded) {
        const [supplier] = await tx.select({ id: suppliersTable.id }).from(suppliersTable).limit(1);
        if (!supplier) {
          await tx.insert(suppliersTable).values(SAMPLE_SUPPLIERS);
        }
        await tx
          .update(workspaceStateTable)
          .set({ sampleDataSeeded: true })
          .where(eq(workspaceStateTable.id, 1));
      }
    }).catch((error: unknown) => {
      initialization = undefined;
      throw error;
    });
  }
  return initialization;
}

export function supplierResponse(supplier: Supplier) {
  return {
    id: supplier.id,
    code: `S-${String(supplier.id).padStart(3, "0")}`,
    name: supplier.name,
    location: supplier.location,
    certifications: supplier.certifications,
    price: supplier.price,
    quality: supplier.quality,
    delivery: supplier.delivery,
    reliability: supplier.reliability,
    createdAt: supplier.createdAt.toISOString(),
    updatedAt: supplier.updatedAt.toISOString(),
  };
}

export function evaluationSummary(
  evaluation: EvaluationRecord,
){
  return {
    id: evaluation.id,
    winnerName: evaluation.winnerName,
    winnerScore: evaluation.winnerScore,
    supplierCount: evaluation.supplierCount,
    qualifiedCount: evaluation.qualifiedCount,
    criteriaCount: evaluation.criteriaCount,
    createdAt: evaluation.createdAt.toISOString(),
    anchor: evaluation.anchor as EvaluationAnchorRecord | null,
  };
}

export async function logActivity(
  eventType: ActivityType,
  message: string,
  evaluationId: number | null = null,
): Promise<void> {
  await db.insert(activityTable).values({ eventType, message, evaluationId });
}

export function validateCriteria(
  criteria: CriterionRuleRecord[],
): string | undefined {
  const expectedKeys: CriterionKey[] = [
    "price",
    "quality",
    "delivery",
    "reliability",
  ];
  if (
    criteria.length !== expectedKeys.length ||
    new Set(criteria.map((rule) => rule.key)).size !== expectedKeys.length ||
    !expectedKeys.every((key) => criteria.some((rule) => rule.key === key))
  ) {
    return "Provide each of the four evaluation criteria exactly once.";
  }

  const active = criteria.filter((rule) => rule.enabled);
  if (active.length === 0) {
    return "Enable at least one criterion.";
  }
  if (active.reduce((total, rule) => total + rule.weight, 0) !== 100) {
    return "Enabled criterion weights must total 100%.";
  }
  return undefined;
}

export function scoreSuppliers(
  suppliers: Supplier[],
  criteria: CriterionRuleRecord[],
): { ranked: SupplierScoreRecord[]; disqualified: SupplierScoreRecord[] } {
  const active = criteria.filter((rule) => rule.enabled);
  const rows = suppliers.map((supplier) => {
    const failedCriteria = active
      .filter((rule) => supplier[rule.key] < rule.cutoff)
      .map((rule) => rule.key);
    const weighted = active.reduce(
      (total, rule) => total + supplier[rule.key] * rule.weight,
      0,
    );

    return {
      ...supplierResponse(supplier),
      score: Math.round((weighted / 10) * 10) / 10,
      qualified: failedCriteria.length === 0,
      failedCriteria,
    };
  });

  return {
    ranked: rows
      .filter((row) => row.qualified)
      .sort((a, b) => b.score - a.score || a.id - b.id),
    disqualified: rows.filter((row) => !row.qualified),
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function fingerprintEvaluation(
  evaluation: EvaluationRecord,
  verificationSalt: string,
): string {
  const report = {
    evaluationId: evaluation.id,
    criteriaSnapshot: evaluation.criteriaSnapshot,
    ranked: evaluation.ranked,
    disqualified: evaluation.disqualified,
  };
  const saltBytes = Buffer.from(verificationSalt.slice(2), "hex");
  const digest = createHash("sha256")
    .update(Buffer.concat([Buffer.from(stableStringify(report), "utf8"), saltBytes]))
    .digest("hex");
  return `0x${digest}`;
}

export async function getRecentEvaluations(limit: number) {
  const rows = await db
    .select()
    .from(evaluationsTable)
    .orderBy(desc(evaluationsTable.createdAt))
    .limit(limit);
  return rows.map(evaluationSummary);
}

export async function getRecentActivity(limit: number) {
  return db
    .select()
    .from(activityTable)
    .orderBy(desc(activityTable.createdAt), desc(activityTable.id))
    .limit(limit);
}

export async function countEvaluations() {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(evaluationsTable);
  return result?.count ?? 0;
}

export async function countAnchoredEvaluations() {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(evaluationsTable)
    .where(sql`${evaluationsTable.anchor} is not null`);
  return result?.count ?? 0;
}
