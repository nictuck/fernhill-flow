// Frontmatter of untrusted files (R18). Safe YAML (core schema, no custom
// tags, alias cap), one block only, 64 KiB per file, then a typed validator
// per artifact. Validators return the value or `null` plus a reason; the
// caller logs the reason as a warning and skips the artifact — a refresh
// never fails because of one bad file.

import { parseDocument } from "yaml";
import type { IncidentStatus, IntentStatus, PlanStatus, SpecStatus } from "../engine/types.ts";

export const FRONTMATTER_MAX_BYTES = 64 * 1024;

const ID_RE = /^\d{4}$/;
const SLUG_RE = /^[a-z0-9-]{1,100}$/;
const EXCEPTION_ID_RE = /^EX-\d{3,4}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}/;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

export const TITLE_MAX = 200;
export const STRING_MAX = 100;

/**
 * Take only the first `---` … `---` block and parse it with the YAML core
 * schema. Throws on anything that is not a plain mapping.
 */
export function parseFrontmatter(text: string, maxBytes: number = FRONTMATTER_MAX_BYTES): Record<string, unknown> {
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new Error(`file exceeds the ${maxBytes}-byte cap`);
  }
  const src = text.startsWith("﻿") ? text.slice(1) : text;
  const lines = src.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") throw new Error("no frontmatter block");
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i]?.trim() === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) throw new Error("unterminated frontmatter block");
  const block = lines.slice(1, end).join("\n");
  const doc = parseDocument(block, { schema: "core", uniqueKeys: true, strict: true });
  // Unresolved tags and other oddities are warnings in `yaml`; here they are refusals.
  const problem = doc.errors[0] ?? doc.warnings[0];
  if (problem) throw new Error(problem.message.split("\n")[0] ?? "invalid YAML");
  const value: unknown = doc.toJS({ maxAliasCount: 20 });
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("frontmatter is not a mapping");
  }
  return value as Record<string, unknown>;
}

export type Validated<T> = { value: T; reason?: undefined } | { value: null; reason: string };

function fail<T>(reason: string): Validated<T> {
  return { value: null, reason };
}

function cleanString(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  return v.replace(CONTROL_RE, "").slice(0, max);
}

/** A string field: present and a string (empty allowed when `allowEmpty`). */
function str(fm: Record<string, unknown>, key: string, max: number, allowEmpty: boolean): string | { reason: string } {
  if (!(key in fm)) return { reason: `missing ${key}` };
  const v = fm[key];
  if (v === null && allowEmpty) return "";
  const s = cleanString(v, max);
  if (s === undefined) return { reason: `${key} must be a string (quote it)` };
  if (!allowEmpty && s.trim() === "") return { reason: `${key} must not be empty` };
  return s;
}

function isReason(v: unknown): v is { reason: string } {
  return typeof v === "object" && v !== null && "reason" in v;
}

function dateField(fm: Record<string, unknown>, key: string, allowEmpty: boolean): string | { reason: string } {
  const s = str(fm, key, STRING_MAX, allowEmpty);
  if (isReason(s)) return s;
  if (s === "" && allowEmpty) return "";
  if (!DATE_RE.test(s)) return { reason: `${key} must be a YYYY-MM-DD date` };
  return s;
}

function enumField<T extends string>(fm: Record<string, unknown>, key: string, values: readonly T[]): T | { reason: string } {
  const s = str(fm, key, STRING_MAX, false);
  if (isReason(s)) return s;
  if (!(values as readonly string[]).includes(s)) {
    return { reason: `${key} must be one of ${values.join(" | ")} (got "${s}")` };
  }
  return s as T;
}

function idField(fm: Record<string, unknown>, key: string): string | { reason: string } {
  const s = str(fm, key, STRING_MAX, false);
  if (isReason(s)) return s;
  if (!ID_RE.test(s)) return { reason: `${key} must be a 4-digit string like "0001" (quote it)` };
  return s;
}

function stringList(fm: Record<string, unknown>, key: string, itemRe: RegExp): string[] | { reason: string } {
  if (!(key in fm)) return { reason: `missing ${key}` };
  const v = fm[key];
  if (v === null) return [];
  if (!Array.isArray(v)) return { reason: `${key} must be a list` };
  const out: string[] = [];
  for (const item of v) {
    const s = cleanString(item, STRING_MAX);
    if (s === undefined || !itemRe.test(s)) return { reason: `${key} has an invalid entry` };
    out.push(s);
  }
  return out;
}

export const INTENT_STATUSES: readonly IntentStatus[] = ["proposed", "accepted", "parked", "rejected", "done"];
export const SPEC_STATUSES: readonly SpecStatus[] = ["proposed", "accepted", "superseded"];
export const PLAN_STATUSES: readonly PlanStatus[] = ["proposed", "approved", "superseded"];
export const INCIDENT_STATUSES: readonly IncidentStatus[] = ["open", "fix-now", "scheduled", "dismissed", "resolved"];
export const EXCEPTION_STATUSES = ["proposed", "active", "revoked", "expired"] as const;
export type ExceptionStatus = (typeof EXCEPTION_STATUSES)[number];
export const SEVERITIES = ["sev1", "sev2", "sev3"] as const;

export interface IntentFm {
  id: string;
  title: string;
  status: IntentStatus;
  author: string;
  origin: string;
  product: string;
  created: string;
}

export function intentFrontmatter(fm: Record<string, unknown>): Validated<IntentFm> {
  const id = idField(fm, "id");
  if (isReason(id)) return fail(id.reason);
  const title = str(fm, "title", TITLE_MAX, false);
  if (isReason(title)) return fail(title.reason);
  const status = enumField(fm, "status", INTENT_STATUSES);
  if (isReason(status)) return fail(status.reason);
  const author = str(fm, "author", STRING_MAX, true);
  if (isReason(author)) return fail(author.reason);
  const origin = str(fm, "origin", STRING_MAX, true);
  if (isReason(origin)) return fail(origin.reason);
  const product = str(fm, "product", STRING_MAX, true);
  if (isReason(product)) return fail(product.reason);
  if (product !== "" && !SLUG_RE.test(product)) return fail("product must match ^[a-z0-9-]{1,100}$");
  const created = dateField(fm, "created", true);
  if (isReason(created)) return fail(created.reason);
  return { value: { id, title, status, author, origin, product, created } };
}

export interface SpecFm {
  intent: string;
  status: SpecStatus;
  flagged: number;
}

export function specFrontmatter(fm: Record<string, unknown>): Validated<SpecFm> {
  const intent = idField(fm, "intent");
  if (isReason(intent)) return fail(intent.reason);
  const status = enumField(fm, "status", SPEC_STATUSES);
  if (isReason(status)) return fail(status.reason);
  if (!("flagged" in fm)) return fail("missing flagged");
  const flagged = fm["flagged"];
  if (typeof flagged !== "number" || !Number.isInteger(flagged) || flagged < 0) {
    return fail("flagged must be a non-negative integer");
  }
  return { value: { intent, status, flagged } };
}

export interface PlanFm {
  intent: string;
  status: PlanStatus;
  approvedBy: string;
}

export function planFrontmatter(fm: Record<string, unknown>): Validated<PlanFm> {
  const intent = idField(fm, "intent");
  if (isReason(intent)) return fail(intent.reason);
  const status = enumField(fm, "status", PLAN_STATUSES);
  if (isReason(status)) return fail(status.reason);
  const approvedBy = str(fm, "approved_by", STRING_MAX, true);
  if (isReason(approvedBy)) return fail(approvedBy.reason);
  return { value: { intent, status, approvedBy } };
}

export interface IncidentFm {
  product: string;
  severity: string;
  status: IncidentStatus;
  intent: string;
  opened: string;
  triagedBy: string;
  reason: string;
}

export function incidentFrontmatter(fm: Record<string, unknown>): Validated<IncidentFm> {
  const product = str(fm, "product", STRING_MAX, false);
  if (isReason(product)) return fail(product.reason);
  if (!SLUG_RE.test(product)) return fail("product must match ^[a-z0-9-]{1,100}$");
  const severity = enumField(fm, "severity", SEVERITIES);
  if (isReason(severity)) return fail(severity.reason);
  const status = enumField(fm, "status", INCIDENT_STATUSES);
  if (isReason(status)) return fail(status.reason);
  const intentRaw = str(fm, "intent", STRING_MAX, true);
  if (isReason(intentRaw)) return fail(intentRaw.reason);
  if (intentRaw !== "" && !ID_RE.test(intentRaw)) return fail('intent must be "" or a 4-digit string (quote it)');
  const opened = dateField(fm, "opened", false);
  if (isReason(opened)) return fail(opened.reason);
  const triagedBy = str(fm, "triaged_by", STRING_MAX, true);
  if (isReason(triagedBy)) return fail(triagedBy.reason);
  const reason = str(fm, "reason", TITLE_MAX, true);
  if (isReason(reason)) return fail(reason.reason);
  return { value: { product, severity, status, intent: intentRaw, opened, triagedBy, reason } };
}

export interface ExceptionFm {
  id: string;
  status: ExceptionStatus;
  grants: string[];
  repos: string[];
  expires: string;
  authorizedBy: string;
  granted: string;
}

export function exceptionFrontmatter(fm: Record<string, unknown>): Validated<ExceptionFm> {
  const id = str(fm, "id", STRING_MAX, false);
  if (isReason(id)) return fail(id.reason);
  if (!EXCEPTION_ID_RE.test(id)) return fail("id must look like EX-001");
  const status = enumField(fm, "status", EXCEPTION_STATUSES);
  if (isReason(status)) return fail(status.reason);
  const grants = stringList(fm, "grants", /^[a-z-]{1,40}$/);
  if (isReason(grants)) return fail(grants.reason);
  const repos = stringList(fm, "repos", SLUG_RE);
  if (isReason(repos)) return fail(repos.reason);
  const expires = dateField(fm, "expires", false);
  if (isReason(expires)) return fail(expires.reason);
  const authorizedBy = str(fm, "authorized_by", STRING_MAX, true);
  if (isReason(authorizedBy)) return fail(authorizedBy.reason);
  let granted = "";
  if ("granted" in fm) {
    const g = dateField(fm, "granted", true);
    if (isReason(g)) return fail(g.reason);
    granted = g;
  }
  return { value: { id, status, grants, repos, expires, authorizedBy, granted } };
}

export interface PersonaFm {
  id: string;
  enabled: boolean;
}

export function personaFrontmatter(fm: Record<string, unknown>): Validated<PersonaFm> {
  const id = str(fm, "id", STRING_MAX, false);
  if (isReason(id)) return fail(id.reason);
  if (!SLUG_RE.test(id)) return fail("id must match ^[a-z0-9-]{1,100}$");
  if (!("enabled" in fm)) return fail("missing enabled");
  const enabled = fm["enabled"];
  if (typeof enabled !== "boolean") return fail("enabled must be true or false");
  return { value: { id, enabled } };
}
