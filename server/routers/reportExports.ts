import { and, desc, eq, gte, inArray, isNull, like, lte, ne, or } from "drizzle-orm";
import * as XLSX from "xlsx";
import { z } from "zod";
import { amendmentRecords, clientRecords, users } from "../../drizzle/schema";
import { PRIORITIES, WORKFLOW_STATUSES } from "../../shared/taxace";
import { writeActivity } from "../activity";
import { requireCapability } from "../authorization";
import { requireDb } from "../db";
import { storagePut } from "../storage";
import { protectedProcedure, router } from "../_core/trpc";

const reportExportInput = z.object({
  format: z.enum(["csv", "xlsx", "pdf"]),
  includeClosed: z.boolean().default(true),
  search: z.string().trim().max(160).default(""),
  status: z.enum(WORKFLOW_STATUSES).optional(),
  preparerId: z.number().int().positive().optional(),
  priority: z.enum(PRIORITIES).optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  selectedIds: z.array(z.number().int().positive()).max(500).optional(),
});

const HEADERS = [
  "Amendment Record ID",
  "TaxAce Client Record ID",
  "Client Name",
  "Workflow Status",
  "Priority",
  "Assigned Preparer",
  "Amendment Reason",
  "Next Action",
  "Date Started",
  "Date Closed",
  "Last Updated",
] as const;

function startOfUtcDay(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function endOfUtcDay(value: string): Date {
  return new Date(`${value}T23:59:59.999Z`);
}

export const reportExportsRouter = router({
  export: protectedProcedure.input(reportExportInput).mutation(async ({ ctx, input }) => {
    requireCapability(ctx.user, "export");
    if (input.dateFrom && input.dateTo && input.dateFrom > input.dateTo) {
      throw new Error("Report start date cannot be after the end date.");
    }

    const db = await requireDb();
    const conditions = [isNull(amendmentRecords.mergedIntoAmendmentId)];
    if (!input.includeClosed) conditions.push(ne(amendmentRecords.workflowStatus, "Closed"));
    if (input.status) conditions.push(eq(amendmentRecords.workflowStatus, input.status));
    if (input.preparerId) conditions.push(eq(amendmentRecords.assignedPreparerId, input.preparerId));
    if (input.priority) conditions.push(eq(amendmentRecords.priority, input.priority));
    if (input.dateFrom) conditions.push(gte(amendmentRecords.dateStarted, startOfUtcDay(input.dateFrom)));
    if (input.dateTo) conditions.push(lte(amendmentRecords.dateStarted, endOfUtcDay(input.dateTo)));
    if (input.selectedIds?.length) conditions.push(inArray(amendmentRecords.id, input.selectedIds));
    if (input.search) {
      const pattern = `%${input.search}%`;
      conditions.push(
        or(
          like(amendmentRecords.amendmentRecordId, pattern),
          like(amendmentRecords.amendmentReason, pattern),
          like(amendmentRecords.nextAction, pattern),
          like(clientRecords.clientName, pattern),
          like(clientRecords.clientId, pattern),
          like(users.name, pattern),
          like(users.email, pattern),
        )!,
      );
    }

    const rows = await db
      .select({
        id: amendmentRecords.id,
        amendmentRecordId: amendmentRecords.amendmentRecordId,
        clientId: clientRecords.clientId,
        clientName: clientRecords.clientName,
        workflowStatus: amendmentRecords.workflowStatus,
        priority: amendmentRecords.priority,
        preparerName: users.name,
        preparerEmail: users.email,
        amendmentReason: amendmentRecords.amendmentReason,
        nextAction: amendmentRecords.nextAction,
        dateStarted: amendmentRecords.dateStarted,
        dateClosed: amendmentRecords.dateClosed,
        lastUpdated: amendmentRecords.updatedAt,
      })
      .from(amendmentRecords)
      .innerJoin(clientRecords, eq(amendmentRecords.clientId, clientRecords.id))
      .leftJoin(users, eq(amendmentRecords.assignedPreparerId, users.id))
      .where(and(...conditions))
      .orderBy(desc(amendmentRecords.updatedAt));

    const flatRows = rows.map(row => ({
      "Amendment Record ID": row.amendmentRecordId,
      "TaxAce Client Record ID": row.clientId,
      "Client Name": row.clientName,
      "Workflow Status": row.workflowStatus,
      Priority: row.priority,
      "Assigned Preparer": row.preparerName || row.preparerEmail || "Unassigned",
      "Amendment Reason": row.amendmentReason,
      "Next Action": row.nextAction ?? "",
      "Date Started": row.dateStarted.toISOString(),
      "Date Closed": row.dateClosed?.toISOString() ?? "",
      "Last Updated": row.lastUpdated.toISOString(),
    }));

    const filterSummary = [
      input.search ? `Search: ${input.search}` : null,
      input.status ? `Workflow: ${input.status}` : null,
      input.preparerId ? `Preparer ID: ${input.preparerId}` : null,
      input.priority ? `Priority: ${input.priority}` : null,
      input.dateFrom ? `From: ${input.dateFrom}` : null,
      input.dateTo ? `To: ${input.dateTo}` : null,
      input.includeClosed ? "Closed records included" : "Active records only",
    ].filter((value): value is string => Boolean(value));

    const stamp = new Date().toISOString().replaceAll(":", "-").slice(0, 19);
    const filename = `TaxAce-Amendment-Report-${stamp}.${input.format}`;
    let contentType = "text/csv";
    let body: Buffer | string;

    const sheet = XLSX.utils.aoa_to_sheet([Array.from(HEADERS)]);
    if (flatRows.length) XLSX.utils.sheet_add_json(sheet, flatRows, { origin: "A2", skipHeader: true });

    if (input.format === "csv") {
      body = XLSX.utils.sheet_to_csv(sheet);
    } else if (input.format === "xlsx") {
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, "Amendments");
      body = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
      contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    } else {
      const PDFDocument = (await import("pdfkit")).default;
      const doc = new PDFDocument({ margin: 40, size: "LETTER" });
      const chunks: Buffer[] = [];
      doc.on("data", chunk => chunks.push(Buffer.from(chunk)));
      doc.fontSize(18).text("TaxAce Amendment Report");
      doc.moveDown(0.4).fontSize(9).text(`Generated ${new Date().toISOString()}`);
      doc.text(`${flatRows.length} record${flatRows.length === 1 ? "" : "s"}`);
      if (filterSummary.length) doc.text(`Filters: ${filterSummary.join(" · ")}`);
      doc.moveDown();
      if (!flatRows.length) {
        doc.fontSize(10).text("No Amendment Records matched the selected filters.");
      }
      for (const row of flatRows) {
        if (doc.y > 700) doc.addPage();
        doc.fontSize(10).text(`${row["Amendment Record ID"]} · ${row["Client Name"]} · ${row["Workflow Status"]}`);
        doc.fontSize(8).text(`Priority: ${row.Priority} · Preparer: ${row["Assigned Preparer"]}`);
        doc.text(`Reason: ${row["Amendment Reason"]}`);
        if (row["Next Action"]) doc.text(`Next Action: ${row["Next Action"]}`);
        doc.moveDown(0.6);
      }
      doc.end();
      body = await new Promise<Buffer>((resolve, reject) => {
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);
      });
      contentType = "application/pdf";
    }

    await storagePut(`taxace/exports/${ctx.user.id}/${filename}`, body, contentType);
    await writeActivity(db, {
      actorType: "user",
      actorUserId: ctx.user.id,
      action: "Filtered operational report exported",
      entityType: "Report Export",
      newValue: {
        format: input.format,
        filters: {
          search: input.search || null,
          status: input.status ?? null,
          preparerId: input.preparerId ?? null,
          priority: input.priority ?? null,
          dateFrom: input.dateFrom ?? null,
          dateTo: input.dateTo ?? null,
          includeClosed: input.includeClosed,
        },
        selectedIds: input.selectedIds ?? null,
        rowCount: flatRows.length,
      },
    });

    return {
      filename,
      url: `/api/report-exports/${encodeURIComponent(filename)}`,
      rowCount: flatRows.length,
      filterSummary,
    };
  }),
});
