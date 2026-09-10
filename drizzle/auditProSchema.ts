import { integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { opportunityReviews, users } from "./schema.js";

export const opportunityAuditDetails = pgTable(
  "opportunity_audit_details",
  {
    id: serial("id").primaryKey(),
    opportunityReviewId: integer("opportunityReviewId")
      .notNull()
      .references(() => opportunityReviews.id, { onDelete: "restrict" }),
    riskIssueNotes: text("riskIssueNotes"),
    auditStartedAt: timestamp("auditStartedAt"),
    auditCompletedAt: timestamp("auditCompletedAt"),
    updatedById: integer("updatedById")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => [uniqueIndex("opportunity_audit_details_review_unique").on(table.opportunityReviewId)],
);

export type OpportunityAuditDetail = typeof opportunityAuditDetails.$inferSelect;
