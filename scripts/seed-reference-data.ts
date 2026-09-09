import "dotenv/config";
import { eq } from "drizzle-orm";
import { referenceLists, referenceValues, WORKFLOW_STATUSES } from "../drizzle/schema";
import { closeDbPool, requireDb } from "../server/db";

const lists = [
  {
    key: "amendment-reasons",
    label: "Amendment Reasons",
    values: [
      "Income correction",
      "Deduction or credit correction",
      "Filing status correction",
      "Entity or ownership correction",
      "Informational correction",
      "Other",
    ],
  },
  {
    key: "trigger-sources",
    label: "Trigger Sources",
    values: ["Canopy task review", "Client request", "TaxAce review", "Agency notice", "Other"],
  },
  {
    key: "document-types",
    label: "Document Types",
    values: [
      "Original return",
      "Corrected source document",
      "Supporting workpaper",
      "Client authorization",
      "Payment confirmation",
      "Signature package",
      "Other",
    ],
  },
];

async function upsertList(key: string, label: string, values: string[]) {
  const db = await requireDb();
  let [list] = await db.select().from(referenceLists).where(eq(referenceLists.key, key)).limit(1);

  if (!list) {
    const inserted = await db.insert(referenceLists).values({ key, label, systemLocked: true }).returning({ id: referenceLists.id });
    [list] = await db.select().from(referenceLists).where(eq(referenceLists.id, inserted[0]!.id)).limit(1);
  }

  const existingValues = await db.select().from(referenceValues).where(eq(referenceValues.listId, list!.id));

  for (const [index, labelValue] of values.entries()) {
    const valueKey = labelValue.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (existingValues.some(value => value.key === valueKey)) continue;

    await db.insert(referenceValues).values({
      listId: list!.id,
      key: valueKey,
      label: labelValue,
      sortOrder: index,
      active: true,
      systemLocked: true,
    });
  }
}

async function main() {
  for (const list of lists) await upsertList(list.key, list.label, list.values);
  await upsertList("workflow-statuses", "Workflow Statuses", [...WORKFLOW_STATUSES]);
  console.log("Reference data seed complete. No operational client/amendment data was created.");
}

main().finally(closeDbPool);
