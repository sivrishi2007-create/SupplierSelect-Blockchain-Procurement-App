import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";

export type CriterionKey = "price" | "quality" | "delivery" | "reliability";

export interface CriterionRuleRecord {
  key: CriterionKey;
  label: string;
  enabled: boolean;
  weight: number;
  cutoff: number;
  hint: string;
}

export interface SupplierScoreRecord {
  id: number;
  code: string;
  name: string;
  location: string;
  certifications: string[];
  price: number;
  quality: number;
  delivery: number;
  reliability: number;
  createdAt: string;
  updatedAt: string;
  score: number;
  qualified: boolean;
  failedCriteria: string[];
}

export interface EvaluationAnchorRecord {
  reportHash: string;
  verificationSalt: string;
  transactionHash: string;
  contractAddress: string;
  evaluatorAddress: string;
  chainId: number;
  blockNumber: number;
  anchoredAt: string;
}

export type ActivityType =
  | "supplier_created"
  | "supplier_updated"
  | "supplier_deleted"
  | "criteria_updated"
  | "evaluation_created"
  | "evaluation_anchored";

export const suppliersTable = pgTable("suppliers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  location: text("location").notNull(),
  certifications: text("certifications")
    .array()
    .notNull()
    .default(sql`ARRAY[]::text[]`),
  price: integer("price").notNull(),
  quality: integer("quality").notNull(),
  delivery: integer("delivery").notNull(),
  reliability: integer("reliability").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertSupplierSchema = createInsertSchema(suppliersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertSupplier = z.infer<typeof insertSupplierSchema>;
export type Supplier = typeof suppliersTable.$inferSelect;

export const criteriaTable = pgTable("evaluation_criteria", {
  id: integer("id").primaryKey().default(1),
  version: integer("version").notNull().default(1),
  criteria: jsonb("criteria").$type<CriterionRuleRecord[]>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertCriteriaSchema = createInsertSchema(criteriaTable).omit({
  updatedAt: true,
});
export type InsertCriteria = z.infer<typeof insertCriteriaSchema>;
export type CriteriaRecord = typeof criteriaTable.$inferSelect;

export const evaluationsTable = pgTable("evaluations", {
  id: serial("id").primaryKey(),
  winnerName: text("winner_name"),
  winnerScore: real("winner_score"),
  supplierCount: integer("supplier_count").notNull(),
  qualifiedCount: integer("qualified_count").notNull(),
  criteriaCount: integer("criteria_count").notNull(),
  criteriaSnapshot: jsonb("criteria_snapshot")
    .$type<CriterionRuleRecord[]>()
    .notNull(),
  ranked: jsonb("ranked").$type<SupplierScoreRecord[]>().notNull(),
  disqualified: jsonb("disqualified")
    .$type<SupplierScoreRecord[]>()
    .notNull(),
  anchor: jsonb("anchor").$type<EvaluationAnchorRecord | null>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertEvaluationSchema = createInsertSchema(evaluationsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertEvaluation = z.infer<typeof insertEvaluationSchema>;
export type EvaluationRecord = typeof evaluationsTable.$inferSelect;

export const activityTable = pgTable("procurement_activity", {
  id: serial("id").primaryKey(),
  eventType: text("event_type").$type<ActivityType>().notNull(),
  message: text("message").notNull(),
  evaluationId: integer("evaluation_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertActivitySchema = createInsertSchema(activityTable).omit({
  id: true,
  createdAt: true,
});
export type InsertActivity = z.infer<typeof insertActivitySchema>;
export type ActivityRecord = typeof activityTable.$inferSelect;

export const workspaceStateTable = pgTable("procurement_workspace_state", {
  id: integer("id").primaryKey().default(1),
  sampleDataSeeded: boolean("sample_data_seeded").notNull().default(false),
});
