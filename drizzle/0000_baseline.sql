CREATE TYPE "public"."actor_type" AS ENUM('user', 'system');--> statement-breakpoint
CREATE TYPE "public"."amendment_result" AS ENUM('Additional Refund', 'Reduced Balance Due', 'Increased Refund Offset', 'Balance Due', 'No Financial Change', 'Informational Amendment');--> statement-breakpoint
CREATE TYPE "public"."assignment_role" AS ENUM('Assigned Preparer', 'EA Reviewer', 'Current Owner', 'Assigned Reviewer');--> statement-breakpoint
CREATE TYPE "public"."canopy_import_action" AS ENUM('New', 'Changed', 'Unchanged', 'Older Snapshot', 'Duplicate Occurrence', 'Duplicate / Conflict', 'Rejected');--> statement-breakpoint
CREATE TYPE "public"."client_type" AS ENUM('Individual', 'Business');--> statement-breakpoint
CREATE TYPE "public"."document_checklist_status" AS ENUM('Needed', 'Requested', 'Received', 'Not Applicable');--> statement-breakpoint
CREATE TYPE "public"."filing_method" AS ENUM('Electronic Filing', 'Paper Filing');--> statement-breakpoint
CREATE TYPE "public"."import_batch_status" AS ENUM('Uploaded', 'Validating', 'Ready to Commit', 'Committed', 'Cancelled', 'Failed', 'Completed with Errors');--> statement-breakpoint
CREATE TYPE "public"."import_lane" AS ENUM('Canopy Task Import', 'Client Data Import', 'Reference Data Import', 'Opportunity Import');--> statement-breakpoint
CREATE TYPE "public"."import_row_action" AS ENUM('New', 'Updated', 'Unchanged', 'Duplicate / Conflict', 'Rejected');--> statement-breakpoint
CREATE TYPE "public"."jurisdiction" AS ENUM('Federal', 'California', 'Federal & California', 'Other State');--> statement-breakpoint
CREATE TYPE "public"."opportunity_recommendation" AS ENUM('Recommend Amendment', 'Additional Review Required', 'Awaiting Documentation', 'No Amendment Recommended');--> statement-breakpoint
CREATE TYPE "public"."opportunity_status" AS ENUM('Pending Review', 'Under Review', 'Ready to Create Amendment', 'No Amendment Needed', 'Deferred');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('High', 'Medium', 'Low');--> statement-breakpoint
CREATE TYPE "public"."tax_year_status" AS ENUM('Investigation', 'In Progress', 'Ready for EA Review', 'Waiting for Payment', 'Ready to File', 'Filed', 'Waiting on IRS / FTB', 'Accepted', 'Closed');--> statement-breakpoint
CREATE TYPE "public"."taxace_role" AS ENUM('Admin', 'EA Reviewer', 'Preparer', 'Viewer');--> statement-breakpoint
CREATE TYPE "public"."workflow_status" AS ENUM('Investigation', 'With Client', 'In Progress', 'Ready for EA Review', 'EA Review', 'Waiting for Payment', 'Ready for Signature', 'Ready to File', 'Filed', 'Waiting on IRS / FTB', 'Accepted', 'Closed');--> statement-breakpoint
CREATE TYPE "public"."workspace" AS ENUM('Opportunity Center', 'Amendment Tracker', 'Pipeline', 'Reporting & Analytics', 'Work Queues');--> statement-breakpoint
CREATE TABLE "activity_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"actorType" "actor_type" NOT NULL,
	"actorUserId" integer,
	"action" varchar(160) NOT NULL,
	"entityType" varchar(80) NOT NULL,
	"entityId" integer,
	"clientId" integer,
	"amendmentId" integer,
	"previousValue" jsonb,
	"newValue" jsonb,
	"note" text,
	"correlationId" varchar(64) NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aging_thresholds" (
	"id" serial PRIMARY KEY NOT NULL,
	"workflowStatus" "workflow_status" NOT NULL,
	"approachingDays" integer DEFAULT 14 NOT NULL,
	"overdueDays" integer DEFAULT 30 NOT NULL,
	"updatedById" integer,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "amendment_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"amendmentRecordId" varchar(48) NOT NULL,
	"clientId" integer NOT NULL,
	"workflowStatus" "workflow_status" DEFAULT 'Investigation' NOT NULL,
	"amendmentReasonId" integer,
	"triggerSourceId" integer,
	"amendmentType" varchar(160),
	"amendmentReason" text NOT NULL,
	"assessmentSummary" text,
	"documentsReceivedSummary" text,
	"documentsNeededSummary" text,
	"documentationStatus" varchar(120),
	"auditEstimatedTaxImpact" numeric(14, 2),
	"federalTaxImpact" numeric(14, 2),
	"californiaTaxImpact" numeric(14, 2),
	"estimatedRefundBalanceDue" numeric(14, 2),
	"riskIfNotAmended" text,
	"priority" "priority" DEFAULT 'Medium' NOT NULL,
	"nextAction" text,
	"assignedPreparerId" integer NOT NULL,
	"assignedEaReviewerId" integer,
	"currentOwnerId" integer NOT NULL,
	"dateStarted" timestamp DEFAULT now() NOT NULL,
	"dueDate" timestamp,
	"paymentConfirmedAt" timestamp,
	"signatureReceivedAt" timestamp,
	"lastClientRequestAt" timestamp,
	"lastClientResponseAt" timestamp,
	"dateClosed" timestamp,
	"lastWorkflowStatusChange" timestamp DEFAULT now() NOT NULL,
	"archivedAt" timestamp,
	"mergedIntoAmendmentId" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "amendment_source_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"amendmentId" integer NOT NULL,
	"workGroupId" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"amendmentId" integer,
	"opportunityReviewId" integer,
	"assignmentRole" "assignment_role" NOT NULL,
	"assigneeId" integer NOT NULL,
	"assignedById" integer NOT NULL,
	"assignmentDate" timestamp DEFAULT now() NOT NULL,
	"endedAt" timestamp,
	"current" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_rate_limit_buckets" (
	"key" varchar(160) PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"resetAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canopy_client_aliases" (
	"id" serial PRIMARY KEY NOT NULL,
	"sourceName" varchar(255) NOT NULL,
	"normalizedName" varchar(255) NOT NULL,
	"clientRecordId" integer NOT NULL,
	"firstSeenBatchId" integer NOT NULL,
	"lastSeenBatchId" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canopy_task_clusters" (
	"id" serial PRIMARY KEY NOT NULL,
	"workGroupId" integer NOT NULL,
	"logicalKey" varchar(2000) NOT NULL,
	"logicalKeyHash" varchar(64) NOT NULL,
	"task" varchar(500) NOT NULL,
	"taskType" varchar(160) NOT NULL,
	"taxYear" integer NOT NULL,
	"returnType" varchar(120) NOT NULL,
	"currentSourceStatus" varchar(160) NOT NULL,
	"currentDueDate" date,
	"currentPinnedRaw" varchar(80) NOT NULL,
	"currentPinned" boolean,
	"currentAssigneeRaw" text NOT NULL,
	"currentAssignees" jsonb NOT NULL,
	"sourceMultiplicity" integer DEFAULT 1 NOT NULL,
	"currentConflict" boolean DEFAULT false NOT NULL,
	"currentProjectionHash" varchar(64),
	"lastSeenBatchId" integer NOT NULL,
	"lastSeenSourceExportedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canopy_task_observations" (
	"id" serial PRIMARY KEY NOT NULL,
	"importBatchId" integer NOT NULL,
	"sourceRowNumber" integer NOT NULL,
	"workGroupId" integer,
	"taskClusterId" integer,
	"outcome" "canopy_import_action" NOT NULL,
	"pinned" varchar(80) NOT NULL,
	"sourceStatus" varchar(160) NOT NULL,
	"task" varchar(500) NOT NULL,
	"client" varchar(255) NOT NULL,
	"taskType" varchar(160) NOT NULL,
	"parentTask" varchar(500) NOT NULL,
	"taxYear" integer,
	"returnType" varchar(120) NOT NULL,
	"dueDate" date,
	"assigneeRaw" text NOT NULL,
	"parsedAssignees" jsonb NOT NULL,
	"workGroupKey" varchar(1400) NOT NULL,
	"workGroupKeyHash" varchar(64) NOT NULL,
	"logicalKey" varchar(2000) NOT NULL,
	"logicalKeyHash" varchar(64) NOT NULL,
	"rowHash" varchar(64) NOT NULL,
	"projectionHash" varchar(64) NOT NULL,
	"rawRow" jsonb NOT NULL,
	"extraColumns" jsonb NOT NULL,
	"sourceExportedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canopy_work_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"workGroupKey" varchar(1400) NOT NULL,
	"workGroupKeyHash" varchar(64) NOT NULL,
	"clientRecordId" integer NOT NULL,
	"sourceClientName" varchar(255) NOT NULL,
	"normalizedClientName" varchar(255) NOT NULL,
	"parentTask" varchar(500) NOT NULL,
	"returnType" varchar(120) NOT NULL,
	"firstSeenBatchId" integer NOT NULL,
	"lastSeenBatchId" integer NOT NULL,
	"lastSeenSourceExportedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"clientId" varchar(120) NOT NULL,
	"clientName" varchar(255) NOT NULL,
	"normalizedClientName" varchar(255),
	"clientSinceDate" date,
	"clientType" "client_type",
	"assignedReviewerId" integer,
	"opportunityStatus" "opportunity_status" DEFAULT 'Pending Review' NOT NULL,
	"sourceImportBatchId" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_checklist" (
	"id" serial PRIMARY KEY NOT NULL,
	"amendmentId" integer NOT NULL,
	"documentTypeId" integer NOT NULL,
	"status" "document_checklist_status" DEFAULT 'Needed' NOT NULL,
	"note" text,
	"requestedAt" timestamp,
	"receivedAt" timestamp,
	"updatedById" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"batchId" varchar(48) NOT NULL,
	"lane" "import_lane" NOT NULL,
	"uploaderId" integer NOT NULL,
	"originalFilename" varchar(255) NOT NULL,
	"contentType" varchar(120) NOT NULL,
	"storageKey" varchar(500),
	"resultReportKey" varchar(500),
	"status" "import_batch_status" DEFAULT 'Uploaded' NOT NULL,
	"normalizedHeaders" jsonb,
	"fileHash" varchar(64),
	"sourceExportedAt" timestamp,
	"sourceExportedAtConfirmed" boolean DEFAULT false NOT NULL,
	"headerFingerprint" varchar(64),
	"parserVersion" varchar(80),
	"totalRows" integer DEFAULT 0 NOT NULL,
	"acceptedCount" integer DEFAULT 0 NOT NULL,
	"newCount" integer DEFAULT 0 NOT NULL,
	"updatedCount" integer DEFAULT 0 NOT NULL,
	"changedCount" integer DEFAULT 0 NOT NULL,
	"unchangedCount" integer DEFAULT 0 NOT NULL,
	"olderSnapshotCount" integer DEFAULT 0 NOT NULL,
	"duplicateCount" integer DEFAULT 0 NOT NULL,
	"conflictCount" integer DEFAULT 0 NOT NULL,
	"rejectedCount" integer DEFAULT 0 NOT NULL,
	"clientCount" integer DEFAULT 0 NOT NULL,
	"workGroupCount" integer DEFAULT 0 NOT NULL,
	"logicalClusterCount" integer DEFAULT 0 NOT NULL,
	"errorSummary" text,
	"startedAt" timestamp DEFAULT now() NOT NULL,
	"completedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "import_row_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"importBatchId" integer NOT NULL,
	"sourceRowNumber" integer NOT NULL,
	"normalizedClientId" varchar(120),
	"clientName" varchar(255),
	"action" "import_row_action" NOT NULL,
	"messages" jsonb NOT NULL,
	"targetClientId" integer,
	"normalizedRow" jsonb,
	"rowHash" varchar(64),
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"amendmentId" integer NOT NULL,
	"authorId" integer NOT NULL,
	"body" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"assignments" boolean DEFAULT true NOT NULL,
	"overdue" boolean DEFAULT true NOT NULL,
	"clientSignature" boolean DEFAULT true NOT NULL,
	"documentRequests" boolean DEFAULT true NOT NULL,
	"eaReview" boolean DEFAULT true NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oidc_login_states" (
	"id" serial PRIMARY KEY NOT NULL,
	"stateHash" varchar(64) NOT NULL,
	"codeVerifier" varchar(160) NOT NULL,
	"nonce" varchar(160) NOT NULL,
	"returnTo" varchar(500) DEFAULT '/' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"expiresAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunity_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"clientId" integer NOT NULL,
	"sourceWorkGroupId" integer,
	"assignedReviewerId" integer,
	"opportunityStatus" "opportunity_status" DEFAULT 'Pending Review' NOT NULL,
	"recommendation" "opportunity_recommendation",
	"priority" "priority" DEFAULT 'Medium' NOT NULL,
	"amendmentOpportunity" boolean,
	"previousReturnsReceived" boolean DEFAULT false NOT NULL,
	"priorYearDocumentsReceived" boolean DEFAULT false NOT NULL,
	"triggerSourceId" integer,
	"amendmentReasonId" integer,
	"amendmentReasonSummary" text,
	"documentsReceivedSummary" text,
	"documentsNeededSummary" text,
	"reviewNotes" text,
	"amendmentAssessment" text,
	"estimatedTaxImpact" numeric(14, 2),
	"reviewCompletionDate" timestamp,
	"active" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reference_lists" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(80) NOT NULL,
	"label" varchar(120) NOT NULL,
	"systemLocked" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reference_values" (
	"id" serial PRIMARY KEY NOT NULL,
	"listId" integer NOT NULL,
	"key" varchar(120) NOT NULL,
	"label" varchar(180) NOT NULL,
	"description" text,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"systemLocked" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_views" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"name" varchar(120) NOT NULL,
	"workspace" "workspace" NOT NULL,
	"filters" jsonb NOT NULL,
	"visibleColumns" jsonb,
	"sortConfig" jsonb,
	"grouping" jsonb,
	"shared" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_year_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"amendmentId" integer NOT NULL,
	"clientId" integer NOT NULL,
	"taxYear" integer NOT NULL,
	"taxYearStatus" "tax_year_status" DEFAULT 'Investigation' NOT NULL,
	"filingMethod" "filing_method",
	"jurisdiction" "jurisdiction" NOT NULL,
	"federalStatus" varchar(120),
	"stateStatus" varchar(120),
	"dateFiled" timestamp,
	"dateAccepted" timestamp,
	"amendmentResult" "amendment_result",
	"estimatedImpact" numeric(14, 2),
	"finalImpact" numeric(14, 2),
	"assignedUserId" integer,
	"activeCoverageKey" varchar(180),
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"tokenHash" varchar(64) NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"lastSeenAt" timestamp DEFAULT now() NOT NULL,
	"revokedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text,
	"email" varchar(320) NOT NULL,
	"authIssuer" varchar(255),
	"authSubject" varchar(255),
	"role" "taxace_role" DEFAULT 'Viewer' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"lastSignedIn" timestamp
);
--> statement-breakpoint
CREATE TABLE "opportunity_audit_details" (
	"id" serial PRIMARY KEY NOT NULL,
	"opportunityReviewId" integer NOT NULL,
	"riskIssueNotes" text,
	"auditStartedAt" timestamp,
	"auditCompletedAt" timestamp,
	"updatedById" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_history" ADD CONSTRAINT "activity_history_actorUserId_users_id_fk" FOREIGN KEY ("actorUserId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_history" ADD CONSTRAINT "activity_history_clientId_client_records_id_fk" FOREIGN KEY ("clientId") REFERENCES "public"."client_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_history" ADD CONSTRAINT "activity_history_amendmentId_amendment_records_id_fk" FOREIGN KEY ("amendmentId") REFERENCES "public"."amendment_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aging_thresholds" ADD CONSTRAINT "aging_thresholds_updatedById_users_id_fk" FOREIGN KEY ("updatedById") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amendment_records" ADD CONSTRAINT "amendment_records_clientId_client_records_id_fk" FOREIGN KEY ("clientId") REFERENCES "public"."client_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amendment_records" ADD CONSTRAINT "amendment_records_amendmentReasonId_reference_values_id_fk" FOREIGN KEY ("amendmentReasonId") REFERENCES "public"."reference_values"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amendment_records" ADD CONSTRAINT "amendment_records_triggerSourceId_reference_values_id_fk" FOREIGN KEY ("triggerSourceId") REFERENCES "public"."reference_values"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amendment_records" ADD CONSTRAINT "amendment_records_assignedPreparerId_users_id_fk" FOREIGN KEY ("assignedPreparerId") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amendment_records" ADD CONSTRAINT "amendment_records_assignedEaReviewerId_users_id_fk" FOREIGN KEY ("assignedEaReviewerId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amendment_records" ADD CONSTRAINT "amendment_records_currentOwnerId_users_id_fk" FOREIGN KEY ("currentOwnerId") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amendment_records" ADD CONSTRAINT "amendment_records_mergedIntoAmendmentId_amendment_records_id_fk" FOREIGN KEY ("mergedIntoAmendmentId") REFERENCES "public"."amendment_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amendment_source_links" ADD CONSTRAINT "amendment_source_links_amendmentId_amendment_records_id_fk" FOREIGN KEY ("amendmentId") REFERENCES "public"."amendment_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amendment_source_links" ADD CONSTRAINT "amendment_source_links_workGroupId_canopy_work_groups_id_fk" FOREIGN KEY ("workGroupId") REFERENCES "public"."canopy_work_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_amendmentId_amendment_records_id_fk" FOREIGN KEY ("amendmentId") REFERENCES "public"."amendment_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_opportunityReviewId_opportunity_reviews_id_fk" FOREIGN KEY ("opportunityReviewId") REFERENCES "public"."opportunity_reviews"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_assigneeId_users_id_fk" FOREIGN KEY ("assigneeId") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_assignedById_users_id_fk" FOREIGN KEY ("assignedById") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canopy_client_aliases" ADD CONSTRAINT "canopy_client_aliases_clientRecordId_client_records_id_fk" FOREIGN KEY ("clientRecordId") REFERENCES "public"."client_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canopy_client_aliases" ADD CONSTRAINT "canopy_client_aliases_firstSeenBatchId_import_batches_id_fk" FOREIGN KEY ("firstSeenBatchId") REFERENCES "public"."import_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canopy_client_aliases" ADD CONSTRAINT "canopy_client_aliases_lastSeenBatchId_import_batches_id_fk" FOREIGN KEY ("lastSeenBatchId") REFERENCES "public"."import_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canopy_task_clusters" ADD CONSTRAINT "canopy_task_clusters_workGroupId_canopy_work_groups_id_fk" FOREIGN KEY ("workGroupId") REFERENCES "public"."canopy_work_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canopy_task_clusters" ADD CONSTRAINT "canopy_task_clusters_lastSeenBatchId_import_batches_id_fk" FOREIGN KEY ("lastSeenBatchId") REFERENCES "public"."import_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canopy_task_observations" ADD CONSTRAINT "canopy_task_observations_importBatchId_import_batches_id_fk" FOREIGN KEY ("importBatchId") REFERENCES "public"."import_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canopy_task_observations" ADD CONSTRAINT "canopy_task_observations_workGroupId_canopy_work_groups_id_fk" FOREIGN KEY ("workGroupId") REFERENCES "public"."canopy_work_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canopy_task_observations" ADD CONSTRAINT "canopy_task_observations_taskClusterId_canopy_task_clusters_id_fk" FOREIGN KEY ("taskClusterId") REFERENCES "public"."canopy_task_clusters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canopy_work_groups" ADD CONSTRAINT "canopy_work_groups_clientRecordId_client_records_id_fk" FOREIGN KEY ("clientRecordId") REFERENCES "public"."client_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canopy_work_groups" ADD CONSTRAINT "canopy_work_groups_firstSeenBatchId_import_batches_id_fk" FOREIGN KEY ("firstSeenBatchId") REFERENCES "public"."import_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canopy_work_groups" ADD CONSTRAINT "canopy_work_groups_lastSeenBatchId_import_batches_id_fk" FOREIGN KEY ("lastSeenBatchId") REFERENCES "public"."import_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_records" ADD CONSTRAINT "client_records_assignedReviewerId_users_id_fk" FOREIGN KEY ("assignedReviewerId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_records" ADD CONSTRAINT "client_records_sourceImportBatchId_import_batches_id_fk" FOREIGN KEY ("sourceImportBatchId") REFERENCES "public"."import_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_checklist" ADD CONSTRAINT "document_checklist_amendmentId_amendment_records_id_fk" FOREIGN KEY ("amendmentId") REFERENCES "public"."amendment_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_checklist" ADD CONSTRAINT "document_checklist_documentTypeId_reference_values_id_fk" FOREIGN KEY ("documentTypeId") REFERENCES "public"."reference_values"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_checklist" ADD CONSTRAINT "document_checklist_updatedById_users_id_fk" FOREIGN KEY ("updatedById") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_uploaderId_users_id_fk" FOREIGN KEY ("uploaderId") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_row_results" ADD CONSTRAINT "import_row_results_importBatchId_import_batches_id_fk" FOREIGN KEY ("importBatchId") REFERENCES "public"."import_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_row_results" ADD CONSTRAINT "import_row_results_targetClientId_client_records_id_fk" FOREIGN KEY ("targetClientId") REFERENCES "public"."client_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_amendmentId_amendment_records_id_fk" FOREIGN KEY ("amendmentId") REFERENCES "public"."amendment_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_authorId_users_id_fk" FOREIGN KEY ("authorId") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_reviews" ADD CONSTRAINT "opportunity_reviews_clientId_client_records_id_fk" FOREIGN KEY ("clientId") REFERENCES "public"."client_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_reviews" ADD CONSTRAINT "opportunity_reviews_sourceWorkGroupId_canopy_work_groups_id_fk" FOREIGN KEY ("sourceWorkGroupId") REFERENCES "public"."canopy_work_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_reviews" ADD CONSTRAINT "opportunity_reviews_assignedReviewerId_users_id_fk" FOREIGN KEY ("assignedReviewerId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_reviews" ADD CONSTRAINT "opportunity_reviews_triggerSourceId_reference_values_id_fk" FOREIGN KEY ("triggerSourceId") REFERENCES "public"."reference_values"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_reviews" ADD CONSTRAINT "opportunity_reviews_amendmentReasonId_reference_values_id_fk" FOREIGN KEY ("amendmentReasonId") REFERENCES "public"."reference_values"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_values" ADD CONSTRAINT "reference_values_listId_reference_lists_id_fk" FOREIGN KEY ("listId") REFERENCES "public"."reference_lists"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_year_records" ADD CONSTRAINT "tax_year_records_amendmentId_amendment_records_id_fk" FOREIGN KEY ("amendmentId") REFERENCES "public"."amendment_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_year_records" ADD CONSTRAINT "tax_year_records_clientId_client_records_id_fk" FOREIGN KEY ("clientId") REFERENCES "public"."client_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_year_records" ADD CONSTRAINT "tax_year_records_assignedUserId_users_id_fk" FOREIGN KEY ("assignedUserId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_audit_details" ADD CONSTRAINT "opportunity_audit_details_opportunityReviewId_opportunity_reviews_id_fk" FOREIGN KEY ("opportunityReviewId") REFERENCES "public"."opportunity_reviews"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_audit_details" ADD CONSTRAINT "opportunity_audit_details_updatedById_users_id_fk" FOREIGN KEY ("updatedById") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_entity_created_idx" ON "activity_history" USING btree ("entityType","entityId","createdAt");--> statement-breakpoint
CREATE INDEX "activity_amendment_created_idx" ON "activity_history" USING btree ("amendmentId","createdAt");--> statement-breakpoint
CREATE INDEX "activity_created_idx" ON "activity_history" USING btree ("createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "aging_thresholds_status_unique" ON "aging_thresholds" USING btree ("workflowStatus");--> statement-breakpoint
CREATE UNIQUE INDEX "amendment_records_public_id_unique" ON "amendment_records" USING btree ("amendmentRecordId");--> statement-breakpoint
CREATE INDEX "amendment_records_client_status_idx" ON "amendment_records" USING btree ("clientId","workflowStatus");--> statement-breakpoint
CREATE INDEX "amendment_records_workflow_idx" ON "amendment_records" USING btree ("workflowStatus");--> statement-breakpoint
CREATE INDEX "amendment_records_preparer_idx" ON "amendment_records" USING btree ("assignedPreparerId");--> statement-breakpoint
CREATE INDEX "amendment_records_owner_idx" ON "amendment_records" USING btree ("currentOwnerId");--> statement-breakpoint
CREATE INDEX "amendment_records_status_changed_idx" ON "amendment_records" USING btree ("lastWorkflowStatusChange");--> statement-breakpoint
CREATE UNIQUE INDEX "amendment_source_links_unique" ON "amendment_source_links" USING btree ("amendmentId","workGroupId");--> statement-breakpoint
CREATE INDEX "assignments_amendment_current_idx" ON "assignments" USING btree ("amendmentId","current");--> statement-breakpoint
CREATE INDEX "assignments_assignee_current_idx" ON "assignments" USING btree ("assigneeId","current");--> statement-breakpoint
CREATE INDEX "auth_rate_limit_buckets_reset_idx" ON "auth_rate_limit_buckets" USING btree ("resetAt");--> statement-breakpoint
CREATE UNIQUE INDEX "canopy_client_aliases_normalized_unique" ON "canopy_client_aliases" USING btree ("normalizedName");--> statement-breakpoint
CREATE INDEX "canopy_client_aliases_client_idx" ON "canopy_client_aliases" USING btree ("clientRecordId");--> statement-breakpoint
CREATE UNIQUE INDEX "canopy_task_clusters_key_hash_unique" ON "canopy_task_clusters" USING btree ("logicalKeyHash");--> statement-breakpoint
CREATE INDEX "canopy_task_clusters_work_group_idx" ON "canopy_task_clusters" USING btree ("workGroupId");--> statement-breakpoint
CREATE INDEX "canopy_task_clusters_year_return_idx" ON "canopy_task_clusters" USING btree ("taxYear","returnType");--> statement-breakpoint
CREATE INDEX "canopy_task_clusters_status_idx" ON "canopy_task_clusters" USING btree ("currentSourceStatus");--> statement-breakpoint
CREATE UNIQUE INDEX "canopy_observations_batch_row_unique" ON "canopy_task_observations" USING btree ("importBatchId","sourceRowNumber");--> statement-breakpoint
CREATE INDEX "canopy_observations_cluster_idx" ON "canopy_task_observations" USING btree ("taskClusterId","sourceExportedAt");--> statement-breakpoint
CREATE INDEX "canopy_observations_work_group_idx" ON "canopy_task_observations" USING btree ("workGroupId","sourceExportedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "canopy_work_groups_key_hash_unique" ON "canopy_work_groups" USING btree ("workGroupKeyHash");--> statement-breakpoint
CREATE INDEX "canopy_work_groups_client_idx" ON "canopy_work_groups" USING btree ("clientRecordId");--> statement-breakpoint
CREATE INDEX "canopy_work_groups_parent_return_idx" ON "canopy_work_groups" USING btree ("parentTask","returnType");--> statement-breakpoint
CREATE UNIQUE INDEX "client_records_client_id_unique" ON "client_records" USING btree ("clientId");--> statement-breakpoint
CREATE INDEX "client_records_name_idx" ON "client_records" USING btree ("clientName");--> statement-breakpoint
CREATE INDEX "client_records_normalized_name_idx" ON "client_records" USING btree ("normalizedClientName");--> statement-breakpoint
CREATE INDEX "client_records_opportunity_idx" ON "client_records" USING btree ("opportunityStatus");--> statement-breakpoint
CREATE INDEX "client_records_reviewer_idx" ON "client_records" USING btree ("assignedReviewerId");--> statement-breakpoint
CREATE INDEX "document_checklist_amendment_idx" ON "document_checklist" USING btree ("amendmentId","status");--> statement-breakpoint
CREATE UNIQUE INDEX "import_batches_batch_id_unique" ON "import_batches" USING btree ("batchId");--> statement-breakpoint
CREATE INDEX "import_batches_uploader_started_idx" ON "import_batches" USING btree ("uploaderId","startedAt");--> statement-breakpoint
CREATE INDEX "import_batches_status_idx" ON "import_batches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "import_batches_source_exported_idx" ON "import_batches" USING btree ("sourceExportedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "import_row_batch_row_unique" ON "import_row_results" USING btree ("importBatchId","sourceRowNumber");--> statement-breakpoint
CREATE INDEX "import_row_batch_action_idx" ON "import_row_results" USING btree ("importBatchId","action");--> statement-breakpoint
CREATE INDEX "notes_amendment_created_idx" ON "notes" USING btree ("amendmentId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preferences_user_unique" ON "notification_preferences" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "oidc_login_states_state_hash_unique" ON "oidc_login_states" USING btree ("stateHash");--> statement-breakpoint
CREATE INDEX "oidc_login_states_expires_idx" ON "oidc_login_states" USING btree ("expiresAt");--> statement-breakpoint
CREATE INDEX "opportunity_reviews_client_active_idx" ON "opportunity_reviews" USING btree ("clientId","active");--> statement-breakpoint
CREATE INDEX "opportunity_reviews_status_idx" ON "opportunity_reviews" USING btree ("opportunityStatus");--> statement-breakpoint
CREATE INDEX "opportunity_reviews_reviewer_idx" ON "opportunity_reviews" USING btree ("assignedReviewerId");--> statement-breakpoint
CREATE INDEX "opportunity_reviews_source_work_group_idx" ON "opportunity_reviews" USING btree ("sourceWorkGroupId","active");--> statement-breakpoint
CREATE UNIQUE INDEX "reference_lists_key_unique" ON "reference_lists" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "reference_values_list_key_unique" ON "reference_values" USING btree ("listId","key");--> statement-breakpoint
CREATE INDEX "reference_values_list_active_idx" ON "reference_values" USING btree ("listId","active","sortOrder");--> statement-breakpoint
CREATE UNIQUE INDEX "saved_views_user_workspace_name_unique" ON "saved_views" USING btree ("userId","workspace","name");--> statement-breakpoint
CREATE INDEX "saved_views_workspace_shared_idx" ON "saved_views" USING btree ("workspace","shared");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_year_active_coverage_unique" ON "tax_year_records" USING btree ("activeCoverageKey");--> statement-breakpoint
CREATE INDEX "tax_year_amendment_idx" ON "tax_year_records" USING btree ("amendmentId");--> statement-breakpoint
CREATE INDEX "tax_year_year_idx" ON "tax_year_records" USING btree ("taxYear");--> statement-breakpoint
CREATE INDEX "tax_year_status_idx" ON "tax_year_records" USING btree ("taxYearStatus");--> statement-breakpoint
CREATE UNIQUE INDEX "user_sessions_token_hash_unique" ON "user_sessions" USING btree ("tokenHash");--> statement-breakpoint
CREATE INDEX "user_sessions_user_expires_idx" ON "user_sessions" USING btree ("userId","expiresAt");--> statement-breakpoint
CREATE INDEX "user_sessions_expires_idx" ON "user_sessions" USING btree ("expiresAt");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_auth_identity_unique" ON "users" USING btree ("authIssuer","authSubject");--> statement-breakpoint
CREATE INDEX "users_role_active_idx" ON "users" USING btree ("role","active");--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_audit_details_review_unique" ON "opportunity_audit_details" USING btree ("opportunityReviewId");
