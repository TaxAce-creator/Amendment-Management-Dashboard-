import { activityHistory } from "../drizzle/schema";

export type ActivityInput = {
  actorType: "user" | "system";
  actorUserId?: number | null;
  action: string;
  entityType: string;
  entityId?: number | null;
  clientId?: number | null;
  amendmentId?: number | null;
  previousValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  note?: string | null;
  correlationId?: string;
};

export async function writeActivity(db: any, input: ActivityInput) {
  await db.insert(activityHistory).values({
    actorType: input.actorType,
    actorUserId: input.actorUserId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    clientId: input.clientId ?? null,
    amendmentId: input.amendmentId ?? null,
    previousValue: input.previousValue ?? null,
    newValue: input.newValue ?? null,
    note: input.note ?? null,
    correlationId: input.correlationId ?? crypto.randomUUID(),
  });
}
