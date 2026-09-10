import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const layout = readFileSync(new URL("../client/src/components/TaxAceLayout.tsx", import.meta.url), "utf8");
const notifications = readFileSync(new URL("./routers/notifications.ts", import.meta.url), "utf8");
const settings = readFileSync(new URL("./routers/settings.ts", import.meta.url), "utf8");
const appRouter = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");

describe("Slice 7 operational notification center", () => {
  it("wires the notification router into the application", () => {
    expect(appRouter).toContain('from "./routers/notifications.js"');
    expect(appRouter).toContain("notifications: notificationsRouter");
  });

  it("replaces the dead bell with a persisted-data alert center", () => {
    expect(layout).toContain("trpc.notifications.center.useQuery");
    expect(layout).toContain("Operational alerts");
    expect(layout).toContain("alert.href");
    expect(layout).toContain("criticalCount");
  });

  it("derives alerts from approved operational categories and preferences", () => {
    expect(notifications).toContain('category: "Assignment"');
    expect(notifications).toContain('category: "Overdue"');
    expect(notifications).toContain('category: "Client Signature"');
    expect(notifications).toContain('category: "Document Request"');
    expect(notifications).toContain('category: "EA Review"');
    expect(notifications).toContain("notificationPreferences");
    expect(notifications).not.toContain("email");
    expect(notifications).not.toContain("sms");
  });
});

describe("Slice 7 Viewer Settings boundary", () => {
  it("keeps Settings configuration and preference writes outside Viewer capability", () => {
    expect(settings).toContain('configuration: protectedProcedure.query');
    expect(settings).toContain('requireCapability(ctx.user, "manageSettings")');
    const manageSettingsChecks = settings.match(/requireCapability\(ctx\.user, "manageSettings"\)/g) ?? [];
    expect(manageSettingsChecks.length).toBeGreaterThanOrEqual(5);
  });
});
