import { eq } from "drizzle-orm";
import { agingThresholds, referenceLists, referenceValues } from "../drizzle/schema.js";
import { SYSTEM_REFERENCE_LISTS, WORKFLOW_STATUSES } from "../shared/taxace.js";
import { requireDb } from "./db.js";

const LIST_LABELS: Record<keyof typeof SYSTEM_REFERENCE_LISTS, string> = {
  amendmentReasons: "Amendment Reasons",
  triggerSources: "Trigger Sources",
  documentTypes: "Document Types",
};

function toKey(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function ensureSystemConfiguration(): Promise<void> {
  const db = await requireDb();

  await db.transaction(async tx => {
    for (const [listKey, values] of Object.entries(SYSTEM_REFERENCE_LISTS) as [
      keyof typeof SYSTEM_REFERENCE_LISTS,
      readonly string[],
    ][]) {
      await tx
        .insert(referenceLists)
        .values({ key: listKey, label: LIST_LABELS[listKey], systemLocked: true })
        .onConflictDoUpdate({
          target: referenceLists.key,
          set: { label: LIST_LABELS[listKey], systemLocked: true },
        });

      const [list] = await tx.select().from(referenceLists).where(eq(referenceLists.key, listKey)).limit(1);
      if (!list) throw new Error(`Unable to initialize reference list ${listKey}`);

      for (let sortOrder = 0; sortOrder < values.length; sortOrder += 1) {
        const label = values[sortOrder];
        if (!label) continue;
        await tx
          .insert(referenceValues)
          .values({
            listId: list.id,
            key: toKey(label),
            label,
            sortOrder,
            active: true,
            systemLocked: true,
          })
          .onConflictDoUpdate({
            target: [referenceValues.listId, referenceValues.key],
            set: { label, sortOrder, active: true, systemLocked: true },
          });
      }
    }

    for (const workflowStatus of WORKFLOW_STATUSES) {
      await tx
        .insert(agingThresholds)
        .values({ workflowStatus, approachingDays: 14, overdueDays: 30 })
        .onConflictDoUpdate({
          target: agingThresholds.workflowStatus,
          set: { workflowStatus },
        });
    }
  });
}
