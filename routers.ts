import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { readCookie } from "./auth/security";
import { revokeUserSession } from "./auth/sessionStore";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import {
  activityRouter,
  amendmentsRouter,
  assignmentsRouter,
  clientsRouter,
  notesRouter,
  taxYearsRouter,
} from "./routers/amendmentOperations";
import { opportunitiesRouter } from "./routers/opportunities";
import { auditProRouter } from "./routers/auditPro";
import { canopyImportsRouter } from "./routers/canopyImports";
import { documentsRouter } from "./routers/documents";
import { reportingRouter, searchRouter } from "./routers/insights";
import { notificationsRouter } from "./routers/notifications";
import { operationalViewsRouter } from "./routers/operationalViews";
import { reportExportsRouter } from "./routers/reportExports";
import { savedViewsRouter } from "./routers/savedViews";
import { settingsRouter } from "./routers/settings";
import { sourceReportingRouter } from "./routers/sourceReporting";
import { workspaceActionsRouter } from "./routers/workspaceActions";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => {
      const user = opts.ctx.user;
      if (!user) return null;
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        active: user.active,
        lastSignedIn: user.lastSignedIn,
      };
    }),
    logout: publicProcedure.mutation(async ({ ctx }) => {
      const token = readCookie(ctx.req, COOKIE_NAME);
      try {
        if (token) await revokeUserSession(token);
      } finally {
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      }
      return { success: true } as const;
    }),
  }),
  clients: clientsRouter,
  opportunities: opportunitiesRouter,
  auditPro: auditProRouter,
  amendments: amendmentsRouter,
  taxYears: taxYearsRouter,
  assignments: assignmentsRouter,
  documents: documentsRouter,
  workspaceActions: workspaceActionsRouter,
  notes: notesRouter,
  activity: activityRouter,
  imports: canopyImportsRouter,
  reporting: reportingRouter,
  reportExports: reportExportsRouter,
  notifications: notificationsRouter,
  operationalViews: operationalViewsRouter,
  sourceReporting: sourceReportingRouter,
  search: searchRouter,
  savedViews: savedViewsRouter,
  settings: settingsRouter,
});

export type AppRouter = typeof appRouter;
