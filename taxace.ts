import type { TaxAceRole, WorkflowStatus } from "../drizzle/schema";

export const PRODUCT_NAME = "TaxAce";

export const TAXACE_ROLES = ["Admin", "EA Reviewer", "Preparer", "Viewer"] as const satisfies readonly TaxAceRole[];
export const OPPORTUNITY_STATUSES = [
  "Pending Review",
  "Under Review",
  "Ready to Create Amendment",
  "No Amendment Needed",
  "Deferred",
] as const;
export const WORKFLOW_STATUSES = [
  "Investigation",
  "With Client",
  "In Progress",
  "Ready for EA Review",
  "EA Review",
  "Waiting for Payment",
  "Ready for Signature",
  "Ready to File",
  "Filed",
  "Waiting on IRS / FTB",
  "Accepted",
  "Closed",
] as const satisfies readonly WorkflowStatus[];
export const TAX_YEAR_STATUSES = [
  "Investigation",
  "In Progress",
  "Ready for EA Review",
  "Waiting for Payment",
  "Ready to File",
  "Filed",
  "Waiting on IRS / FTB",
  "Accepted",
  "Closed",
] as const;
export const PRIORITIES = ["High", "Medium", "Low"] as const;

export const WORKFLOW_TRANSITIONS: Record<WorkflowStatus, readonly WorkflowStatus[]> = {
  Investigation: ["With Client", "In Progress"],
  "With Client": ["Investigation", "In Progress"],
  "In Progress": ["With Client", "Ready for EA Review"],
  "Ready for EA Review": ["In Progress", "EA Review"],
  "EA Review": ["Ready for EA Review", "In Progress", "Waiting for Payment"],
  "Waiting for Payment": ["EA Review", "Ready for Signature"],
  "Ready for Signature": ["Waiting for Payment", "Ready to File"],
  "Ready to File": ["Ready for Signature", "Filed"],
  Filed: ["Ready to File", "Waiting on IRS / FTB"],
  "Waiting on IRS / FTB": ["Filed", "Accepted"],
  Accepted: ["Waiting on IRS / FTB", "Closed"],
  Closed: [],
};

export type Capability =
  | "view"
  | "reviewOpportunity"
  | "createAmendment"
  | "editTechnical"
  | "performEaReview"
  | "coordinateWorkflow"
  | "assign"
  | "changePriority"
  | "archive"
  | "splitMerge"
  | "close"
  | "import"
  | "export"
  | "manageSettings"
  | "manageUsers"
  | "manageSharedViews";

const ADMIN_CAPABILITIES: readonly Capability[] = [
  "view",
  "reviewOpportunity",
  "createAmendment",
  "editTechnical",
  "performEaReview",
  "coordinateWorkflow",
  "assign",
  "changePriority",
  "archive",
  "splitMerge",
  "close",
  "import",
  "export",
  "manageSettings",
  "manageUsers",
  "manageSharedViews",
];

export const ROLE_CAPABILITIES: Record<TaxAceRole, readonly Capability[]> = {
  Admin: ADMIN_CAPABILITIES,
  "EA Reviewer": ADMIN_CAPABILITIES,
  Preparer: ADMIN_CAPABILITIES,
  Viewer: ["view", "export"],
};

export function hasCapability(role: TaxAceRole, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}

export function canTransition(from: WorkflowStatus, to: WorkflowStatus): boolean {
  return WORKFLOW_TRANSITIONS[from].includes(to);
}

export function getNextWorkflowStatuses(status: WorkflowStatus): readonly WorkflowStatus[] {
  return WORKFLOW_TRANSITIONS[status];
}

export type TransitionPrerequisites = {
  paymentConfirmed: boolean;
  signatureReceived: boolean;
  allTaxYearsClosed: boolean;
};

export function validateWorkflowTransition(
  from: WorkflowStatus,
  to: WorkflowStatus,
  prerequisites: TransitionPrerequisites,
): string | null {
  if (!canTransition(from, to)) return "Workflow Status cannot skip a required stage.";
  if (from === "Waiting for Payment" && to === "Ready for Signature" && !prerequisites.paymentConfirmed) {
    return "Payment must be confirmed before the amendment can move to Ready for Signature.";
  }
  if (from === "Ready for Signature" && to === "Ready to File" && !prerequisites.signatureReceived) {
    return "Client signature must be recorded before the amendment can move to Ready to File.";
  }
  if (to === "Closed" && !prerequisites.allTaxYearsClosed) {
    return "All Tax Year Records must be Closed before the Amendment Record can be closed.";
  }
  return null;
}

export function activeCoverageKey(clientRecordId: number, taxYear: number): string {
  return `${clientRecordId}:${taxYear}`;
}

export const SYSTEM_REFERENCE_LISTS = {
  amendmentReasons: [
    "Income Correction",
    "Deduction or Credit Change",
    "Filing Status Change",
    "Carryback or Carryforward",
    "Entity Information Correction",
    "Agency Notice Response",
    "Other",
  ],
  triggerSources: [
    "TaxAce Review",
    "Client Request",
    "Agency Notice",
    "Prior Return Review",
    "Internal Quality Review",
    "Other",
  ],
  documentTypes: [
    "Prior Tax Return",
    "Income Statement",
    "Expense Documentation",
    "Agency Notice",
    "Entity Document",
    "Authorization Form",
    "Payment Confirmation",
    "Signature Authorization",
    "Other Supporting Document",
  ],
} as const;
