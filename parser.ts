import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import {
  CANOPY_PARSER_VERSION,
  CANOPY_TASK_HEADERS,
  type CanopyImportPreview,
  type ExistingCanopyClusterProjection,
  type ParsedCanopyRow,
} from "./contract";

export class CanopyImportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanopyImportValidationError";
  }
}

const REQUIRED_HEADERS = new Set<string>(CANOPY_TASK_HEADERS);

function importMaxRows(): number {
  const configured = Number(process.env.IMPORT_MAX_ROWS ?? 10000);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 10000;
}

export function normalizeCanopyText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeCanopyKeyPart(value: unknown): string {
  return normalizeCanopyText(value).toLocaleLowerCase("en-US");
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: Record<string, unknown>): string {
  return JSON.stringify(
    Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = value[key];
        return result;
      }, {}),
  );
}

export function parseCanopyExportTimestamp(filename: string): Date | null {
  const match = /CanopyTasks_(\d{4})-(\d{2})-(\d{2})_(\d{1,2})\.(\d{2})(AM|PM)/i.exec(filename);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, meridiemText] = match;
  let hour = Number(hourText);
  const minute = Number(minuteText);
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (![year, month, day, hour, minute].every(Number.isFinite) || hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
  const meridiem = meridiemText.toUpperCase();
  if (hour === 12) hour = 0;
  if (meridiem === "PM") hour += 12;
  const value = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
  if (
    value.getUTCFullYear() !== year ||
    value.getUTCMonth() !== month - 1 ||
    value.getUTCDate() !== day ||
    value.getUTCHours() !== hour ||
    value.getUTCMinutes() !== minute
  ) return null;
  return value;
}

export function parseCanopyAssignees(raw: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of raw.split(",")) {
    const name = normalizeCanopyText(value);
    if (!name) continue;
    const key = normalizeCanopyKeyPart(name);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}

function parsePinned(raw: string): boolean | null {
  const normalized = normalizeCanopyKeyPart(raw);
  if (normalized === "yes") return true;
  if (normalized === "no") return false;
  return null;
}

function parseTaxYear(raw: string): number | null {
  if (!/^\d{4}$/.test(raw)) return null;
  const value = Number(raw);
  return value >= 1900 && value <= 2200 ? value : null;
}

function parseDueDate(raw: string): string | null | undefined {
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) return undefined;
  return raw;
}

export function buildCanopyWorkGroupKey(input: { client: string; parentTask: string; returnType: string }): string {
  return [input.client, input.parentTask, input.returnType].map(normalizeCanopyKeyPart).join("|");
}

export function buildCanopyLogicalKey(input: {
  client: string;
  parentTask: string;
  returnType: string;
  task: string;
  taskType: string;
  taxYear: string | number;
}): string {
  const workGroup = buildCanopyWorkGroupKey(input);
  return [workGroup, normalizeCanopyKeyPart(input.task), normalizeCanopyKeyPart(input.taskType), normalizeCanopyKeyPart(input.taxYear)].join("|");
}

function projectionHash(row: { sourceStatus: string; sourceDueDate: string | null; sourcePinnedRaw: string; sourceAssigneeRaw: string }): string {
  return sha256(stableJson({ status: row.sourceStatus, dueDate: row.sourceDueDate, pinned: row.sourcePinnedRaw, assignee: row.sourceAssigneeRaw }));
}

function toDateValue(value: Date | string | null): number | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? null : time;
}

function readWorkbook(buffer: Buffer): unknown[][] {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer", cellDates: false, raw: true });
  } catch {
    throw new CanopyImportValidationError("The uploaded file could not be read as a CSV or Excel workbook.");
  }
  const firstSheetName = workbook.SheetNames.find(name => Boolean(workbook.Sheets[name]?.["!ref"]));
  if (!firstSheetName) throw new CanopyImportValidationError("The uploaded file does not contain a populated worksheet.");
  const sheet = workbook.Sheets[firstSheetName];
  if (!sheet) throw new CanopyImportValidationError("The populated worksheet could not be read.");
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: true });
}

export function buildCanopyTaskPreview(input: {
  filename: string;
  buffer: Buffer;
  sourceExportedAt?: Date | string | null;
  existingClusters?: ExistingCanopyClusterProjection[];
}): CanopyImportPreview {
  const matrix = readWorkbook(input.buffer);
  if (matrix.length === 0) throw new CanopyImportValidationError("The uploaded file does not contain a header row.");
  const populatedRows = matrix.slice(1).filter(source => !source.every(value => normalizeCanopyText(value) === ""));
  if (populatedRows.length > importMaxRows()) {
    throw new CanopyImportValidationError(`The Canopy export contains ${populatedRows.length} data rows, exceeding the configured ${importMaxRows()} row limit.`);
  }

  const headers = (matrix[0] ?? []).map(normalizeCanopyText);
  const nonEmptyHeaders = headers.filter(Boolean);
  const duplicateHeaders = nonEmptyHeaders.filter((header, index) => nonEmptyHeaders.indexOf(header) !== index);
  if (duplicateHeaders.length > 0) throw new CanopyImportValidationError(`Duplicate headers are not allowed: ${Array.from(new Set(duplicateHeaders)).join(", ")}.`);
  const missing = CANOPY_TASK_HEADERS.filter(header => !headers.includes(header));
  if (missing.length > 0) throw new CanopyImportValidationError(`Missing required Canopy headers: ${missing.join(", ")}.`);
  const extraHeaders = nonEmptyHeaders.filter(header => !REQUIRED_HEADERS.has(header));
  const headerIndex = new Map(headers.map((header, index) => [header, index]));

  const inferredTimestamp = parseCanopyExportTimestamp(input.filename);
  const explicitTimestamp = input.sourceExportedAt ? new Date(input.sourceExportedAt) : null;
  if (explicitTimestamp && Number.isNaN(explicitTimestamp.getTime())) throw new CanopyImportValidationError("Source Exported At is not a valid timestamp.");
  const sourceExportedAt = explicitTimestamp ?? inferredTimestamp;
  const existingByKey = new Map((input.existingClusters ?? []).map(cluster => [cluster.logicalKey, cluster]));

  const rows: ParsedCanopyRow[] = [];
  for (let matrixIndex = 1; matrixIndex < matrix.length; matrixIndex += 1) {
    const source = matrix[matrixIndex] ?? [];
    if (source.every(value => normalizeCanopyText(value) === "")) continue;
    const sourceRowNumber = matrixIndex + 1;
    const get = (header: string) => normalizeCanopyText(source[headerIndex.get(header) ?? -1]);
    const client = get("Client");
    const parentTask = get("Parent Task");
    const task = get("Task");
    const taskType = get("Task Type");
    const taxYearRaw = get("Tax Year");
    const returnType = get("Return Type");
    const sourceStatus = get("Status");
    const sourceDueRaw = get("Due date");
    const sourcePinnedRaw = get("Pinned");
    const sourceAssigneeRaw = get("Assignee");
    const taxYear = parseTaxYear(taxYearRaw);
    const sourceDueDate = parseDueDate(sourceDueRaw);
    const messages: string[] = [];
    if (!client) messages.push("Client is required.");
    if (!task) messages.push("Task is required.");
    if (!taskType) messages.push("Task Type is required.");
    if (!parentTask) messages.push("Parent Task is required.");
    if (!taxYear) messages.push("Tax Year must be a valid four-digit year.");
    if (!returnType) messages.push("Return Type is required.");
    if (sourceDueDate === undefined) messages.push("Due date must be blank or use YYYY-MM-DD.");

    const rawRow = Object.fromEntries(headers.map((header, index) => [header || `Column ${index + 1}`, normalizeCanopyText(source[index])]));
    const extraColumns = Object.fromEntries(extraHeaders.map(header => [header, get(header)]));
    const workGroupKey = buildCanopyWorkGroupKey({ client, parentTask, returnType });
    const logicalKey = buildCanopyLogicalKey({ client, parentTask, returnType, task, taskType, taxYear: taxYearRaw });
    const mutableHash = projectionHash({ sourceStatus, sourceDueDate: sourceDueDate ?? null, sourcePinnedRaw, sourceAssigneeRaw });
    const rowHash = sha256(stableJson(rawRow));
    rows.push({
      sourceRowNumber,
      action: messages.length > 0 ? "Rejected" : "New",
      messages,
      client,
      normalizedClient: normalizeCanopyKeyPart(client),
      parentTask,
      task,
      taskType,
      taxYear,
      returnType,
      sourceStatus,
      sourceDueDate: sourceDueDate ?? null,
      sourcePinnedRaw,
      sourcePinned: parsePinned(sourcePinnedRaw),
      sourceAssigneeRaw,
      parsedAssignees: parseCanopyAssignees(sourceAssigneeRaw),
      workGroupKey,
      logicalKey,
      rowHash,
      projectionHash: mutableHash,
      rawRow,
      extraColumns,
    });
  }

  const grouped = new Map<string, ParsedCanopyRow[]>();
  for (const row of rows) {
    if (row.action === "Rejected") continue;
    const group = grouped.get(row.logicalKey) ?? [];
    group.push(row);
    grouped.set(row.logicalKey, group);
  }

  for (const [logicalKey, group] of Array.from(grouped.entries())) {
    const distinctProjectionHashes = new Set(group.map(row => row.projectionHash));
    if (distinctProjectionHashes.size > 1) {
      for (const row of group) {
        row.action = "Duplicate / Conflict";
        row.messages.push("Rows with the same logical Canopy task key disagree on mutable source values.");
      }
      continue;
    }
    const existing = existingByKey.get(logicalKey);
    const currentProjectionHash = group[0]?.projectionHash ?? null;
    let firstAction: ParsedCanopyRow["action"] = "New";
    if (existing) {
      const existingTime = toDateValue(existing.sourceExportedAt);
      const incomingTime = sourceExportedAt?.getTime() ?? null;
      if (existingTime !== null && incomingTime !== null && incomingTime < existingTime) firstAction = "Older Snapshot";
      else if (existing.projectionHash === currentProjectionHash) firstAction = "Unchanged";
      else firstAction = "Changed";
    }
    if (group[0]) {
      group[0].action = firstAction;
      group[0].messages.push(firstAction === "Older Snapshot" ? "Observation will be retained, but this older snapshot will not roll back the current projection." : firstAction === "Unchanged" ? "Mutable Canopy source values match the current projection." : firstAction === "Changed" ? "Mutable Canopy source values changed in this snapshot." : "New logical Canopy task cluster.");
    }
    for (const duplicate of group.slice(1)) {
      duplicate.action = "Duplicate Occurrence";
      duplicate.messages.push("Repeated occurrence of the same logical Canopy task row in this export.");
    }
  }

  const acceptedRows = rows.filter(row => !["Rejected", "Duplicate / Conflict"].includes(row.action));
  const counts = {
    totalRows: rows.length,
    acceptedRows: acceptedRows.length,
    clients: new Set(acceptedRows.map(row => row.normalizedClient)).size,
    workGroups: new Set(acceptedRows.map(row => row.workGroupKey)).size,
    logicalClusters: new Set(acceptedRows.map(row => row.logicalKey)).size,
    new: rows.filter(row => row.action === "New").length,
    changed: rows.filter(row => row.action === "Changed").length,
    unchanged: rows.filter(row => row.action === "Unchanged").length,
    olderSnapshots: rows.filter(row => row.action === "Older Snapshot").length,
    duplicateOccurrences: rows.filter(row => row.action === "Duplicate Occurrence").length,
    conflicts: rows.filter(row => row.action === "Duplicate / Conflict").length,
    rejected: rows.filter(row => row.action === "Rejected").length,
  };

  return {
    headers: nonEmptyHeaders,
    extraHeaders,
    sourceExportedAt: sourceExportedAt?.toISOString() ?? null,
    sourceExportedAtInferred: Boolean(!explicitTimestamp && inferredTimestamp),
    headerFingerprint: sha256(CANOPY_TASK_HEADERS.join("|")),
    parserVersion: CANOPY_PARSER_VERSION,
    fileHash: sha256(input.buffer),
    rows,
    counts,
  };
}
