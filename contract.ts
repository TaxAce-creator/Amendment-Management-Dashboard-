export const CANOPY_TASK_HEADERS = [
  "Pinned",
  "Status",
  "Task",
  "Client",
  "Task Type",
  "Parent Task",
  "Tax Year",
  "Return Type",
  "Due date",
  "Assignee",
] as const;

export const CANOPY_PARSER_VERSION = "canopy-task-export-v1";

export type CanopyTaskHeader = (typeof CANOPY_TASK_HEADERS)[number];

export type ExistingCanopyClusterProjection = {
  logicalKey: string;
  projectionHash: string | null;
  sourceExportedAt: Date | string | null;
};

export type CanopyRowAction =
  | "New"
  | "Changed"
  | "Unchanged"
  | "Older Snapshot"
  | "Duplicate Occurrence"
  | "Duplicate / Conflict"
  | "Rejected";

export type ParsedCanopyRow = {
  sourceRowNumber: number;
  action: CanopyRowAction;
  messages: string[];
  client: string;
  normalizedClient: string;
  parentTask: string;
  task: string;
  taskType: string;
  taxYear: number | null;
  returnType: string;
  sourceStatus: string;
  sourceDueDate: string | null;
  sourcePinnedRaw: string;
  sourcePinned: boolean | null;
  sourceAssigneeRaw: string;
  parsedAssignees: string[];
  workGroupKey: string;
  logicalKey: string;
  rowHash: string;
  projectionHash: string;
  rawRow: Record<string, string>;
  extraColumns: Record<string, string>;
};

export type CanopyImportPreview = {
  headers: string[];
  extraHeaders: string[];
  sourceExportedAt: string | null;
  sourceExportedAtInferred: boolean;
  headerFingerprint: string;
  parserVersion: string;
  fileHash: string;
  rows: ParsedCanopyRow[];
  counts: {
    totalRows: number;
    acceptedRows: number;
    clients: number;
    workGroups: number;
    logicalClusters: number;
    new: number;
    changed: number;
    unchanged: number;
    olderSnapshots: number;
    duplicateOccurrences: number;
    conflicts: number;
    rejected: number;
  };
};
