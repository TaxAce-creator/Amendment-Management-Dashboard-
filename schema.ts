import {
  boolean,
  date,
  decimal,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const TAXACE_ROLES = ["Admin", "EA Reviewer", "Preparer", "Viewer"] as const;
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
] as const;
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
export const CANOPY_IMPORT_ACTIONS = [
  "New",
  "Changed",
  "Unchanged",
  "Older Snapshot",
  "Duplicate Occurrence",
  "Duplicate / Conflict",
  "Rejected",
] as const;

// Postgres enum types. Each must be defined once at module scope and reused
// across every table that needs it (Postgres enum types are named, global
// objects — unlike MySQL's inline per-column enums).
export const roleEnum = pgEnum("role", TAXACE_ROLES);
export const importLaneEnum = pgEnum("import_lane", [
  "Canopy Task Import",
  "Client Data Import",
  "Reference Data Import",
  "Opportunity Import",
]);
export const importBatchStatusEnum = pgEnum("import_batch_status", [
  "Uploaded",
  "Validating",
  "Ready to Commit",
  "Committed",
  "Cancelled",
  "Failed",
  "Completed with Errors",
]);
export const clientTypeEnum = pgEnum("client_type", ["Individual", "Business"]);
export const opportunityStatusEnum = pgEnum("opportunity_status", OPPORTUNITY_STATUSES);
export const canopyImportOutcomeEnum = pgEnum("canopy_import_outcome", CANOPY_IMPORT_ACTIONS);
export const recommendationEnum = pgEnum("recommendation", [
  "Recommend Amendment",
  "Additional Review Required",
  "Awaiting Documentation",
  "No Amendment Recommended",
]);
export const priorityEnum = pgEnum("priority", PRIORITIES);
export const workflowStatusEnum = pgEnum("workflow_status", WORKFLOW_STATUSES);
export const taxYearStatusEnum = pgEnum("tax_year_status", TAX_YEAR_STATUSES);
export const filingMethodEnum = pgEnum("filing_method", ["Electronic Filing", "Paper Filing"]);
export const jurisdictionEnum = pgEnum("jurisdiction", [
  "Federal",
  "California",
  "Federal & California",
  "Other State",
]);
export const amendmentResultEnum = pgEnum("amendment_result", [
  "Additional Refund",
  "Reduced Balance Due",
  "Increased Refund Offset",
  "Balance Due",
  "No Financial Change",
  "Informational Amendment",
]);
export const assignmentRoleEnum = pgEnum("assignment_role", [
  "Assigned Preparer",
  "EA Reviewer",
  "Current Owner",
  "Assigned Reviewer",
]);
export const documentChecklistStatusEnum = pgEnum("document_checklist_status", [
  "Needed",
  "Requested",
  "Received",
  "Not Applicable",
]);
export const actorTypeEnum = pgEnum("actor_type", ["user", "system"]);
export const importRowActionEnum = pgEnum("import_row_action", [
  "New",
  "Updated",
  "Unchanged",
  "Duplicate / Conflict",
  "Rejected",
]);
export const savedViewWorkspaceEnum = pgEnum("saved_view_workspace", [
  "Opportunity Center",
  "Amendment Tracker",
  "Pipeline",
  "Reporting & Analytics",
  "Work Queues",
]);

// NOTE on updatedAt: MySQL's `.onUpdateNow()` has no direct Drizzle/Postgres
// equivalent. Every table below keeps `updatedAt` as a plain timestamp
// column; a `set_updated_at()` trigger (added in the generated migration,
// see drizzle/0000_baseline_postgres.sql) stamps it on every UPDATE so
// application code does not need to set it manually.

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    name: text("name"),
    email: varchar("email", { length: 320 }).notNull(),
    authIssuer: varchar("authIssuer", { length: 255 }),
    authSubject: varchar("authSubject", { length: 255 }),
    role: roleEnum("role").default("Viewer").notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
    lastSignedIn: timestamp("lastSignedIn"),
  },
  table => [
    uniqueIndex("users_email_unique").on(table.email),
    uniqueIndex("users_auth_identity_unique").on(table.authIssuer, table.authSubject),
    index("users_role_active_idx").on(table.role, table.active),
  ],
);

export const userSessions = pgTable(
  "user_sessions",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("tokenHash", { length: 64 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    lastSeenAt: timestamp("lastSeenAt").defaultNow().notNull(),
    revokedAt: timestamp("revokedAt"),
  },
  table => [
    uniqueIndex("user_sessions_token_hash_unique").on(table.tokenHash),
    index("user_sessions_user_expires_idx").on(table.userId, table.expiresAt),
    index("user_sessions_expires_idx").on(table.expiresAt),
  ],
);

export const oidcLoginStates = pgTable(
  "oidc_login_states",
  {
    id: serial("id").primaryKey(),
    stateHash: varchar("stateHash", { length: 64 }).notNull(),
    codeVerifier: varchar("codeVerifier", { length: 160 }).notNull(),
    nonce: varchar("nonce", { length: 160 }).notNull(),
    returnTo: varchar("returnTo", { length: 500 }).default("/").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
  },
  table => [
    uniqueIndex("oidc_login_states_state_hash_unique").on(table.stateHash),
    index("oidc_login_states_expires_idx").on(table.expiresAt),
  ],
);

export const referenceLists = pgTable(
  "reference_lists",
  {
    id: serial("id").primaryKey(),
    key: varchar("key", { length: 80 }).notNull(),
    label: varchar("label", { length: 120 }).notNull(),
    systemLocked: boolean("systemLocked").default(false).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => [uniqueIndex("reference_lists_key_unique").on(table.key)],
);

export const referenceValues = pgTable(
  "reference_values",
  {
    id: serial("id").primaryKey(),
    listId: integer("listId").notNull().references(() => referenceLists.id, { onDelete: "restrict" }),
    key: varchar("key", { length: 120 }).notNull(),
    label: varchar("label", { length: 180 }).notNull(),
    description: text("description"),
    sortOrder: integer("sortOrder").default(0).notNull(),
    active: boolean("active").default(true).notNull(),
    systemLocked: boolean("systemLocked").default(false).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => [
    uniqueIndex("reference_values_list_key_unique").on(table.listId, table.key),
    index("reference_values_list_active_idx").on(table.listId, table.active, table.sortOrder),
  ],
);

export const importBatches = pgTable(
  "import_batches",
  {
    id: serial("id").primaryKey(),
    batchId: varchar("batchId", { length: 48 }).notNull(),
    lane: importLaneEnum("lane").notNull(),
    uploaderId: integer("uploaderId").notNull().references(() => users.id, { onDelete: "restrict" }),
    originalFilename: varchar("originalFilename", { length: 255 }).notNull(),
    contentType: varchar("contentType", { length: 120 }).notNull(),
    storageKey: varchar("storageKey", { length: 500 }),
    resultReportKey: varchar("resultReportKey", { length: 500 }),
    status: importBatchStatusEnum("status").default("Uploaded").notNull(),
    normalizedHeaders: jsonb("normalizedHeaders").$type<string[]>(),
    fileHash: varchar("fileHash", { length: 64 }),
    sourceExportedAt: timestamp("sourceExportedAt"),
    sourceExportedAtConfirmed: boolean("sourceExportedAtConfirmed").default(false).notNull(),
    headerFingerprint: varchar("headerFingerprint", { length: 64 }),
    parserVersion: varchar("parserVersion", { length: 80 }),
    totalRows: integer("totalRows").default(0).notNull(),
    acceptedCount: integer("acceptedCount").default(0).notNull(),
    newCount: integer("newCount").default(0).notNull(),
    updatedCount: integer("updatedCount").default(0).notNull(),
    changedCount: integer("changedCount").default(0).notNull(),
    unchangedCount: integer("unchangedCount").default(0).notNull(),
    olderSnapshotCount: integer("olderSnapshotCount").default(0).notNull(),
    duplicateCount: integer("duplicateCount").default(0).notNull(),
    conflictCount: integer("conflictCount").default(0).notNull(),
    rejectedCount: integer("rejectedCount").default(0).notNull(),
    clientCount: integer("clientCount").default(0).notNull(),
    workGroupCount: integer("workGroupCount").default(0).notNull(),
    logicalClusterCount: integer("logicalClusterCount").default(0).notNull(),
    errorSummary: text("errorSummary"),
    startedAt: timestamp("startedAt").defaultNow().notNull(),
    completedAt: timestamp("completedAt"),
  },
  table => [
    uniqueIndex("import_batches_batch_id_unique").on(table.batchId),
    index("import_batches_uploader_started_idx").on(table.uploaderId, table.startedAt),
    index("import_batches_status_idx").on(table.status),
    index("import_batches_source_exported_idx").on(table.sourceExportedAt),
  ],
);

export const clientRecords = pgTable(
  "client_records",
  {
    id: serial("id").primaryKey(),
    clientId: varchar("clientId", { length: 120 }).notNull(),
    clientName: varchar("clientName", { length: 255 }).notNull(),
    normalizedClientName: varchar("normalizedClientName", { length: 255 }),
    clientSinceDate: date("clientSinceDate", { mode: "string" }),
    clientType: clientTypeEnum("clientType"),
    assignedReviewerId: integer("assignedReviewerId").references(() => users.id, { onDelete: "set null" }),
    opportunityStatus: opportunityStatusEnum("opportunityStatus").default("Pending Review").notNull(),
    sourceImportBatchId: integer("sourceImportBatchId").references(() => importBatches.id, { onDelete: "set null" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => [
    uniqueIndex("client_records_client_id_unique").on(table.clientId),
    index("client_records_name_idx").on(table.clientName),
    index("client_records_normalized_name_idx").on(table.normalizedClientName),
    index("client_records_opportunity_idx").on(table.opportunityStatus),
    index("client_records_reviewer_idx").on(table.assignedReviewerId),
  ],
);

export const canopyClientAliases = pgTable(
  "canopy_client_aliases",
  {
    id: serial("id").primaryKey(),
    sourceName: varchar("sourceName", { length: 255 }).notNull(),
    normalizedName: varchar("normalizedName", { length: 255 }).notNull(),
    clientRecordId: integer("clientRecordId").notNull().references(() => clientRecords.id, { onDelete: "restrict" }),
    firstSeenBatchId: integer("firstSeenBatchId").notNull().references(() => importBatches.id, { onDelete: "restrict" }),
    lastSeenBatchId: integer("lastSeenBatchId").notNull().references(() => importBatches.id, { onDelete: "restrict" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => [
    uniqueIndex("canopy_client_aliases_normalized_unique").on(table.normalizedName),
    index("canopy_client_aliases_client_idx").on(table.clientRecordId),
  ],
);

export const canopyWorkGroups = pgTable(
  "canopy_work_groups",
  {
    id: serial("id").primaryKey(),
    workGroupKey: varchar("workGroupKey", { length: 1400 }).notNull(),
    workGroupKeyHash: varchar("workGroupKeyHash", { length: 64 }).notNull(),
    clientRecordId: integer("clientRecordId").notNull().references(() => clientRecords.id, { onDelete: "restrict" }),
    sourceClientName: varchar("sourceClientName", { length: 255 }).notNull(),
    normalizedClientName: varchar("normalizedClientName", { length: 255 }).notNull(),
    parentTask: varchar("parentTask", { length: 500 }).notNull(),
    returnType: varchar("returnType", { length: 120 }).notNull(),
    firstSeenBatchId: integer("firstSeenBatchId").notNull().references(() => importBatches.id, { onDelete: "restrict" }),
    lastSeenBatchId: integer("lastSeenBatchId").notNull().references(() => importBatches.id, { onDelete: "restrict" }),
    lastSeenSourceExportedAt: timestamp("lastSeenSourceExportedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => [
    uniqueIndex("canopy_work_groups_key_hash_unique").on(table.workGroupKeyHash),
    index("canopy_work_groups_client_idx").on(table.clientRecordId),
    index("canopy_work_groups_parent_return_idx").on(table.parentTask, table.returnType),
  ],
);

export const canopyTaskClusters = pgTable(
  "canopy_task_clusters",
  {
    id: serial("id").primaryKey(),
    workGroupId: integer("workGroupId").notNull().references(() => canopyWorkGroups.id, { onDelete: "restrict" }),
    logicalKey: varchar("logicalKey", { length: 2000 }).notNull(),
    logicalKeyHash: varchar("logicalKeyHash", { length: 64 }).notNull(),
    task: varchar("task", { length: 500 }).notNull(),
    taskType: varchar("taskType", { length: 160 }).notNull(),
    taxYear: integer("taxYear").notNull(),
    returnType: varchar("returnType", { length: 120 }).notNull(),
    currentSourceStatus: varchar("currentSourceStatus", { length: 160 }).notNull(),
    currentDueDate: date("currentDueDate", { mode: "string" }),
    currentPinnedRaw: varchar("currentPinnedRaw", { length: 80 }).notNull(),
    currentPinned: boolean("currentPinned"),
    currentAssigneeRaw: text("currentAssigneeRaw").notNull(),
    currentAssignees: jsonb("currentAssignees").$type<string[]>().notNull(),
    sourceMultiplicity: integer("sourceMultiplicity").default(1).notNull(),
    currentConflict: boolean("currentConflict").default(false).notNull(),
    currentProjectionHash: varchar("currentProjectionHash", { length: 64 }),
    lastSeenBatchId: integer("lastSeenBatchId").notNull().references(() => importBatches.id, { onDelete: "restrict" }),
    lastSeenSourceExportedAt: timestamp("lastSeenSourceExportedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => [
    uniqueIndex("canopy_task_clusters_key_hash_unique").on(table.logicalKeyHash),
    index("canopy_task_clusters_work_group_idx").on(table.workGroupId),
    index("canopy_task_clusters_year_return_idx").on(table.taxYear, table.returnType),
    index("canopy_task_clusters_status_idx").on(table.currentSourceStatus),
  ],
);

export const canopyTaskObservations = pgTable(
  "canopy_task_observations",
  {
    id: serial("id").primaryKey(),
    importBatchId: integer("importBatchId").notNull().references(() => importBatches.id, { onDelete: "restrict" }),
    sourceRowNumber: integer("sourceRowNumber").notNull(),
    workGroupId: integer("workGroupId").references(() => canopyWorkGroups.id, { onDelete: "restrict" }),
    taskClusterId: integer("taskClusterId").references(() => canopyTaskClusters.id, { onDelete: "restrict" }),
    outcome: canopyImportOutcomeEnum("outcome").notNull(),
    pinned: varchar("pinned", { length: 80 }).notNull(),
    sourceStatus: varchar("sourceStatus", { length: 160 }).notNull(),
    task: varchar("task", { length: 500 }).notNull(),
    client: varchar("client", { length: 255 }).notNull(),
    taskType: varchar("taskType", { length: 160 }).notNull(),
    parentTask: varchar("parentTask", { length: 500 }).notNull(),
    taxYear: integer("taxYear"),
    returnType: varchar("returnType", { length: 120 }).notNull(),
    dueDate: date("dueDate", { mode: "string" }),
    assigneeRaw: text("assigneeRaw").notNull(),
    parsedAssignees: jsonb("parsedAssignees").$type<string[]>().notNull(),
    workGroupKey: varchar("workGroupKey", { length: 1400 }).notNull(),
    workGroupKeyHash: varchar("workGroupKeyHash", { length: 64 }).notNull(),
    logicalKey: varchar("logicalKey", { length: 2000 }).notNull(),
    logicalKeyHash: varchar("logicalKeyHash", { length: 64 }).notNull(),
    rowHash: varchar("rowHash", { length: 64 }).notNull(),
    projectionHash: varchar("projectionHash", { length: 64 }).notNull(),
    rawRow: jsonb("rawRow").$type<Record<string, string>>().notNull(),
    extraColumns: jsonb("extraColumns").$type<Record<string, string>>().notNull(),
    sourceExportedAt: timestamp("sourceExportedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    uniqueIndex("canopy_observations_batch_row_unique").on(table.importBatchId, table.sourceRowNumber),
    index("canopy_observations_cluster_idx").on(table.taskClusterId, table.sourceExportedAt),
    index("canopy_observations_work_group_idx").on(table.workGroupId, table.sourceExportedAt),
  ],
);

export const opportunityReviews = pgTable(
  "opportunity_reviews",
  {
    id: serial("id").primaryKey(),
    clientId: integer("clientId").notNull().references(() => clientRecords.id, { onDelete: "restrict" }),
    sourceWorkGroupId: integer("sourceWorkGroupId").references(() => canopyWorkGroups.id, { onDelete: "restrict" }),
    assignedReviewerId: integer("assignedReviewerId").references(() => users.id, { onDelete: "set null" }),
    opportunityStatus: opportunityStatusEnum("opportunityStatus").default("Pending Review").notNull(),
    recommendation: recommendationEnum("recommendation"),
    priority: priorityEnum("priority").default("Medium").notNull(),
    amendmentOpportunity: boolean("amendmentOpportunity"),
    previousReturnsReceived: boolean("previousReturnsReceived").default(false).notNull(),
    priorYearDocumentsReceived: boolean("priorYearDocumentsReceived").default(false).notNull(),
    triggerSourceId: integer("triggerSourceId").references(() => referenceValues.id, { onDelete: "set null" }),
    amendmentReasonId: integer("amendmentReasonId").references(() => referenceValues.id, { onDelete: "set null" }),
    amendmentReasonSummary: text("amendmentReasonSummary"),
    documentsReceivedSummary: text("documentsReceivedSummary"),
    documentsNeededSummary: text("documentsNeededSummary"),
    reviewNotes: text("reviewNotes"),
    amendmentAssessment: text("amendmentAssessment"),
    estimatedTaxImpact: decimal("estimatedTaxImpact", { precision: 14, scale: 2 }),
    reviewCompletionDate: timestamp("reviewCompletionDate"),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => [
    index("opportunity_reviews_client_active_idx").on(table.clientId, table.active),
    index("opportunity_reviews_status_idx").on(table.opportunityStatus),
    index("opportunity_reviews_reviewer_idx").on(table.assignedReviewerId),
    index("opportunity_reviews_source_work_group_idx").on(table.sourceWorkGroupId, table.active),
  ],
);

export const amendmentRecords = pgTable(
  "amendment_records",
  {
    id: serial("id").primaryKey(),
    amendmentRecordId: varchar("amendmentRecordId", { length: 48 }).notNull(),
    clientId: integer("clientId").notNull().references(() => clientRecords.id, { onDelete: "restrict" }),
    workflowStatus: workflowStatusEnum("workflowStatus").default("Investigation").notNull(),
    amendmentReasonId: integer("amendmentReasonId").references(() => referenceValues.id, { onDelete: "set null" }),
    triggerSourceId: integer("triggerSourceId").references(() => referenceValues.id, { onDelete: "set null" }),
    amendmentType: varchar("amendmentType", { length: 160 }),
    amendmentReason: text("amendmentReason").notNull(),
    assessmentSummary: text("assessmentSummary"),
    documentsReceivedSummary: text("documentsReceivedSummary"),
    documentsNeededSummary: text("documentsNeededSummary"),
    documentationStatus: varchar("documentationStatus", { length: 120 }),
    auditEstimatedTaxImpact: decimal("auditEstimatedTaxImpact", { precision: 14, scale: 2 }),
    federalTaxImpact: decimal("federalTaxImpact", { precision: 14, scale: 2 }),
    californiaTaxImpact: decimal("californiaTaxImpact", { precision: 14, scale: 2 }),
    estimatedRefundBalanceDue: decimal("estimatedRefundBalanceDue", { precision: 14, scale: 2 }),
    riskIfNotAmended: text("riskIfNotAmended"),
    priority: priorityEnum("priority").default("Medium").notNull(),
    nextAction: text("nextAction"),
    assignedPreparerId: integer("assignedPreparerId").notNull().references(() => users.id, { onDelete: "restrict" }),
    assignedEaReviewerId: integer("assignedEaReviewerId").references(() => users.id, { onDelete: "set null" }),
    currentOwnerId: integer("currentOwnerId").notNull().references(() => users.id, { onDelete: "restrict" }),
    dateStarted: timestamp("dateStarted").defaultNow().notNull(),
    dueDate: timestamp("dueDate"),
    paymentConfirmedAt: timestamp("paymentConfirmedAt"),
    signatureReceivedAt: timestamp("signatureReceivedAt"),
    lastClientRequestAt: timestamp("lastClientRequestAt"),
    lastClientResponseAt: timestamp("lastClientResponseAt"),
    dateClosed: timestamp("dateClosed"),
    lastWorkflowStatusChange: timestamp("lastWorkflowStatusChange").defaultNow().notNull(),
    archivedAt: timestamp("archivedAt"),
    mergedIntoAmendmentId: integer("mergedIntoAmendmentId").references((): any => amendmentRecords.id, { onDelete: "restrict" }),
    version: integer("version").default(1).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => [
    uniqueIndex("amendment_records_public_id_unique").on(table.amendmentRecordId),
    index("amendment_records_client_status_idx").on(table.clientId, table.workflowStatus),
    index("amendment_records_workflow_idx").on(table.workflowStatus),
    index("amendment_records_preparer_idx").on(table.assignedPreparerId),
    index("amendment_records_owner_idx").on(table.currentOwnerId),
    index("amendment_records_status_changed_idx").on(table.lastWorkflowStatusChange),
  ],
);

export const amendmentSourceLinks = pgTable(
  "amendment_source_links",
  {
    id: serial("id").primaryKey(),
    amendmentId: integer("amendmentId").notNull().references(() => amendmentRecords.id, { onDelete: "restrict" }),
    workGroupId: integer("workGroupId").notNull().references(() => canopyWorkGroups.id, { onDelete: "restrict" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [uniqueIndex("amendment_source_links_unique").on(table.amendmentId, table.workGroupId)],
);

export const taxYearRecords = pgTable(
  "tax_year_records",
  {
    id: serial("id").primaryKey(),
    amendmentId: integer("amendmentId").notNull().references(() => amendmentRecords.id, { onDelete: "restrict" }),
    clientId: integer("clientId").notNull().references(() => clientRecords.id, { onDelete: "restrict" }),
    taxYear: integer("taxYear").notNull(),
    taxYearStatus: taxYearStatusEnum("taxYearStatus").default("Investigation").notNull(),
    filingMethod: filingMethodEnum("filingMethod"),
    jurisdiction: jurisdictionEnum("jurisdiction").notNull(),
    federalStatus: varchar("federalStatus", { length: 120 }),
    stateStatus: varchar("stateStatus", { length: 120 }),
    dateFiled: timestamp("dateFiled"),
    dateAccepted: timestamp("dateAccepted"),
    amendmentResult: amendmentResultEnum("amendmentResult"),
    estimatedImpact: decimal("estimatedImpact", { precision: 14, scale: 2 }),
    finalImpact: decimal("finalImpact", { precision: 14, scale: 2 }),
    assignedUserId: integer("assignedUserId").references(() => users.id, { onDelete: "set null" }),
    activeCoverageKey: varchar("activeCoverageKey", { length: 180 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => [
    uniqueIndex("tax_year_active_coverage_unique").on(table.activeCoverageKey),
    index("tax_year_amendment_idx").on(table.amendmentId),
    index("tax_year_year_idx").on(table.taxYear),
    index("tax_year_status_idx").on(table.taxYearStatus),
  ],
);

export const assignments = pgTable(
  "assignments",
  {
    id: serial("id").primaryKey(),
    amendmentId: integer("amendmentId").references(() => amendmentRecords.id, { onDelete: "restrict" }),
    opportunityReviewId: integer("opportunityReviewId").references(() => opportunityReviews.id, { onDelete: "restrict" }),
    assignmentRole: assignmentRoleEnum("assignmentRole").notNull(),
    assigneeId: integer("assigneeId").notNull().references(() => users.id, { onDelete: "restrict" }),
    assignedById: integer("assignedById").notNull().references(() => users.id, { onDelete: "restrict" }),
    assignmentDate: timestamp("assignmentDate").defaultNow().notNull(),
    endedAt: timestamp("endedAt"),
    current: boolean("current").default(true).notNull(),
  },
  table => [
    index("assignments_amendment_current_idx").on(table.amendmentId, table.current),
    index("assignments_assignee_current_idx").on(table.assigneeId, table.current),
  ],
);

export const notes = pgTable(
  "notes",
  {
    id: serial("id").primaryKey(),
    amendmentId: integer("amendmentId").notNull().references(() => amendmentRecords.id, { onDelete: "restrict" }),
    authorId: integer("authorId").notNull().references(() => users.id, { onDelete: "restrict" }),
    body: text("body").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("notes_amendment_created_idx").on(table.amendmentId, table.createdAt)],
);

export const documentChecklist = pgTable(
  "document_checklist",
  {
    id: serial("id").primaryKey(),
    amendmentId: integer("amendmentId").notNull().references(() => amendmentRecords.id, { onDelete: "restrict" }),
    documentTypeId: integer("documentTypeId").notNull().references(() => referenceValues.id, { onDelete: "restrict" }),
    status: documentChecklistStatusEnum("status").default("Needed").notNull(),
    note: text("note"),
    requestedAt: timestamp("requestedAt"),
    receivedAt: timestamp("receivedAt"),
    updatedById: integer("updatedById").notNull().references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => [index("document_checklist_amendment_idx").on(table.amendmentId, table.status)],
);

export const activityHistory = pgTable(
  "activity_history",
  {
    id: serial("id").primaryKey(),
    actorType: actorTypeEnum("actorType").notNull(),
    actorUserId: integer("actorUserId").references(() => users.id, { onDelete: "set null" }),
    action: varchar("action", { length: 160 }).notNull(),
    entityType: varchar("entityType", { length: 80 }).notNull(),
    entityId: integer("entityId"),
    clientId: integer("clientId").references(() => clientRecords.id, { onDelete: "set null" }),
    amendmentId: integer("amendmentId").references(() => amendmentRecords.id, { onDelete: "set null" }),
    previousValue: jsonb("previousValue").$type<Record<string, unknown> | null>(),
    newValue: jsonb("newValue").$type<Record<string, unknown> | null>(),
    note: text("note"),
    correlationId: varchar("correlationId", { length: 64 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("activity_entity_created_idx").on(table.entityType, table.entityId, table.createdAt),
    index("activity_amendment_created_idx").on(table.amendmentId, table.createdAt),
    index("activity_created_idx").on(table.createdAt),
  ],
);

export const importRowResults = pgTable(
  "import_row_results",
  {
    id: serial("id").primaryKey(),
    importBatchId: integer("importBatchId").notNull().references(() => importBatches.id, { onDelete: "restrict" }),
    sourceRowNumber: integer("sourceRowNumber").notNull(),
    normalizedClientId: varchar("normalizedClientId", { length: 120 }),
    clientName: varchar("clientName", { length: 255 }),
    action: importRowActionEnum("action").notNull(),
    messages: jsonb("messages").$type<string[]>().notNull(),
    targetClientId: integer("targetClientId").references(() => clientRecords.id, { onDelete: "set null" }),
    normalizedRow: jsonb("normalizedRow").$type<Record<string, string | null>>(),
    rowHash: varchar("rowHash", { length: 64 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    uniqueIndex("import_row_batch_row_unique").on(table.importBatchId, table.sourceRowNumber),
    index("import_row_batch_action_idx").on(table.importBatchId, table.action),
  ],
);

export const savedViews = pgTable(
  "saved_views",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    workspace: savedViewWorkspaceEnum("workspace").notNull(),
    filters: jsonb("filters").$type<Record<string, unknown>>().notNull(),
    visibleColumns: jsonb("visibleColumns").$type<string[]>(),
    sortConfig: jsonb("sortConfig").$type<Record<string, unknown> | null>(),
    grouping: jsonb("grouping").$type<Record<string, unknown> | null>(),
    shared: boolean("shared").default(false).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => [
    uniqueIndex("saved_views_user_workspace_name_unique").on(table.userId, table.workspace, table.name),
    index("saved_views_workspace_shared_idx").on(table.workspace, table.shared),
  ],
);

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    assignments: boolean("assignments").default(true).notNull(),
    overdue: boolean("overdue").default(true).notNull(),
    clientSignature: boolean("clientSignature").default(true).notNull(),
    documentRequests: boolean("documentRequests").default(true).notNull(),
    eaReview: boolean("eaReview").default(true).notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => [uniqueIndex("notification_preferences_user_unique").on(table.userId)],
);

export const agingThresholds = pgTable(
  "aging_thresholds",
  {
    id: serial("id").primaryKey(),
    workflowStatus: workflowStatusEnum("workflowStatus").notNull(),
    approachingDays: integer("approachingDays").default(14).notNull(),
    overdueDays: integer("overdueDays").default(30).notNull(),
    updatedById: integer("updatedById").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => [uniqueIndex("aging_thresholds_status_unique").on(table.workflowStatus)],
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type TaxAceRole = (typeof TAXACE_ROLES)[number];
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];
export type TaxYearStatus = (typeof TAX_YEAR_STATUSES)[number];
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];
