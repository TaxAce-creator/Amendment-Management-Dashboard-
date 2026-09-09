import { LoadingPanel } from "@/components/taxace";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { lazy, Suspense } from "react";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import TaxAceLayout from "./components/TaxAceLayout";
import { ThemeProvider } from "./contexts/ThemeContext";

const ActivityPage = lazy(() => import("./pages/Activity"));
const AmendmentTracker = lazy(() => import("./pages/AmendmentTracker"));
const AmendmentWorkspace = lazy(() => import("./pages/AmendmentWorkspace"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const GlobalSearch = lazy(() => import("./pages/GlobalSearch"));
const NotFound = lazy(() => import("./pages/NotFound"));
const OpportunityCenter = lazy(() => import("./pages/OpportunityCenter"));
const Pipeline = lazy(() => import("./pages/Pipeline"));
const Reports = lazy(() => import("./pages/Reports"));
const SavedViews = lazy(() => import("./pages/SavedViews"));
const SettingsPage = lazy(() => import("./pages/Settings"));
const WorkQueues = lazy(() => import("./pages/WorkQueues"));

function Router() {
  return (
    <TaxAceLayout>
      <Suspense fallback={<LoadingPanel label="Loading TaxAce workspace" />}>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/opportunities" component={OpportunityCenter} />
          <Route path="/amendments/:id" component={AmendmentWorkspace} />
          <Route path="/amendments" component={AmendmentTracker} />
          <Route path="/pipeline" component={Pipeline} />
          <Route path="/reports" component={Reports} />
          <Route path="/activity" component={ActivityPage} />
          <Route path="/queues" component={WorkQueues} />
          <Route path="/search" component={GlobalSearch} />
          <Route path="/saved-views" component={SavedViews} />
          <Route path="/settings" component={SettingsPage} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </TaxAceLayout>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster richColors />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
