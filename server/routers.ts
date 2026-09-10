import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies.js";
import { readCookie } from "./auth/security.js";
import { revokeUserSession } from "./auth/sessionStore.js";
import { systemRouter } from "./_core/systemRouter.js";
import { publicProcedure, router } from "./_core/trpc.js";
import {
  activityRouter,
  amendmentsRouter,
  assignmentsRouter,
  clientsRouter,
  notesRouter,
  taxYearsRouter,
} from "./routers/amendmentOperations.js";
import { opportunitiesRouter } from "./routers/opportunities.js";
import { auditProRouter } from "./routers/auditPro.js";
import { canopyImportsRouter } from "./routers/canopyImports.js";
import { documentsRouter } from "./routers/documents.js";
import { reportingRouter, searchRouter } from "./routers/insights.js";
import { notificationsRouter } from "./routers/notifications.js";
import { operationalViewsRouter } from "./routers/operationalViews.js";
import { reportExportsRouter } from "./routers/reportExports.js";
import { savedViewsRouter } from "./routers/savedViews.js";
import { settingsRouter } from "./routers/settings.js";
import { sourceReportingRouter } from "./routers/sourceReporting.js";
import { workspaceActionsRouter } from "./routers/workspaceActions.js";

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
