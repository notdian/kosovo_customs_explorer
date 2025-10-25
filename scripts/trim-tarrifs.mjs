#!/usr/bin/env node

import { readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const KEEP_FIELDS = new Set([
  "code",
  "description",
  "percentage",
  "cefta",
  "msa",
  "trmtl",
  "tvsh",
  "excise",
  "validFrom",
  "uomCode",
]);
const NULLABLE_FIELDS = new Set(["uomCode"]);
const NUMBER_FIELDS = new Set([
  "percentage",
  "cefta",
  "msa",
  "trmtl",
  "tvsh",
  "excise",
]);
const STRING_FIELDS = new Set(["code", "description", "validFrom", "uomCode"]);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_PATH = path.join(ROOT, "data", "tarrifs.json");

function normalizeValue(key, value) {
  if (NUMBER_FIELDS.has(key)) {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
    return 0;
  }
  if (STRING_FIELDS.has(key)) {
    if (value === undefined || value === null) return "";
    return String(value);
  }
  return value ?? null;
}

function trimRecord(record, index, optionalDropCounts) {
  if (record === null || typeof record !== "object") {
    throw new TypeError(
      `Expected object record at index ${index}, received ${typeof record}`,
    );
  }
  const trimmed = {};
  for (const field of KEEP_FIELDS) {
    const value = record[field];
    if ((value === undefined || value === null) && NULLABLE_FIELDS.has(field)) {
      optionalDropCounts[field] = (optionalDropCounts[field] ?? 0) + 1;
      continue;
    }
    trimmed[field] = normalizeValue(field, value);
  }
  if (!trimmed.code || typeof trimmed.code !== "string") {
    throw new TypeError(`Record at index ${index} is missing required string code`);
  }
  return trimmed;
}

function formatBytes(size) {
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

async function main() {
  const [beforeStat, raw] = await Promise.all([
    stat(DATA_PATH),
    readFile(DATA_PATH, "utf8"),
  ]);

  const data = JSON.parse(raw);
  if (!Array.isArray(data)) {
    throw new TypeError(
      `Expected tariff data to be an array but received ${typeof data}`,
    );
  }

  const optionalDropCounts = {};
  const trimmed = data.map((record, index) => {
    return trimRecord(record, index, optionalDropCounts);
  });

  // Keep only the latest instance (highest index) of each code
  const lastIndexByCode = new Map();
  for (const [index, record] of trimmed.entries()) {
    lastIndexByCode.set(record.code, index);
  }
  const deduped = trimmed.filter(
    (record, index) => lastIndexByCode.get(record.code) === index,
  );
  const duplicateCount = trimmed.length - deduped.length;
  const payload = JSON.stringify(deduped);
  await writeFile(DATA_PATH, payload, "utf8");
  const afterStat = await stat(DATA_PATH);

  const removedFields = Object.keys(data[0] ?? {}).filter(
    (key) => !KEEP_FIELDS.has(key),
  );

  const beforeReadable = formatBytes(beforeStat.size);
  const afterReadable = formatBytes(afterStat.size);

  console.log(
    `Trimmed ${data.length} records. Removed fields: ${removedFields.join(
      ", ",
    ) || "none"}.`,
  );
  if (Object.keys(optionalDropCounts).length) {
    const optionalSummary = Object.entries(optionalDropCounts)
      .map(([field, count]) => `${field}=${count}`)
      .join(", ");
    console.log(`Omitted null fields: ${optionalSummary}`);
  }
  if (duplicateCount > 0) {
    console.log(`Deduplicated ${duplicateCount} records by keeping latest codes.`);
  }
  console.log(`Size: ${beforeReadable} -> ${afterReadable}`);
}

main().catch((error) => {
  console.error("Failed to trim tariff data:", error);
  process.exitCode = 1;
});
