import Dexie, { Table } from "dexie";
import { Encoder, Document as FlexSearchDocument } from "flexsearch";

export interface CustomsRecord {
  code: string;
  description: string;
  percentage: number;
  cefta: number;
  msa: number;
  trmtl: number;
  tvsh: number;
  excise: number;
  validFrom: string;
  uomCode: string | null;

  // computed / optional runtime fields
  rootCode?: string | null;
  highlightedDescription?: string | null;

  // tolerated extras if present in source (ignored)
  fileUrl?: string | null;
  importMeasure?: string | null;
  exportMeasure?: string | null;
}

export type CustomsFlatRow = CustomsRecord;

export type CustomsTreeNode = CustomsFlatRow & {
  subRows: CustomsTreeNode[];
};

type SearchOptions = {
  parentLimit?: number;
  itemLimit?: number;
};

export type InitializationPhase =
  | "load-data"
  | "indexing"
  | "done"
  | "cached"
  | "error";

export type InitializationProgress = {
  phase: InitializationPhase;
  loaded: number;
  total: number;
  message: string;
};

type InitializeOptions = {
  force?: boolean;
  onProgress?: (progress: InitializationProgress) => void;
};

const FLEXSEARCH_HIGHLIGHT_TEMPLATE =
  '<span class="bg-amber-200 rounded px-0.5">$1</span>';
const INDEX_CHUNK_SIZE = 2_000;

/** sort helper */
function sortChildren(a: CustomsTreeNode, b: CustomsTreeNode): number {
  const ac = (a.code ?? "").toString();
  const bc = (b.code ?? "").toString();
  if (ac < bc) return -1;
  if (ac > bc) return 1;
  const ad = (a.description ?? "").toString();
  const bd = (b.description ?? "").toString();
  if (ad < bd) return -1;
  if (ad > bd) return 1;
  return 0;
}

function findParentCode(code: string, codeSet: Set<string>): string | null {
  // longest proper prefix that exists in the dataset
  for (let i = code.length - 1; i > 0; i--) {
    const cand = code.slice(0, i);
    if (codeSet.has(cand)) return cand;
  }
  return null;
}

function buildCachedData(rows: CustomsRecord[]): {
  cache: CustomsFlatRow[];
  byCode: Map<string, CustomsFlatRow>;
  byRootCode: Map<string, CustomsFlatRow[]>;
  rootOrder: string[];
} {
  // stable order by code for deterministic roots
  const cloned: CustomsFlatRow[] = rows
    .map((row) => ({ ...row }))
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

  const byCode = new Map<string, CustomsFlatRow>(
    cloned.map((row) => [row.code, row]),
  );

  const codeSet = new Set<string>(cloned.map((r) => r.code));
  const byRootCode = new Map<string, CustomsFlatRow[]>();
  const rootOrder: string[] = [];

  // compute root for each row (walk prefixes until no parent)
  const rootCache = new Map<string, string | null>();
  const findRoot = (code: string): string => {
    if (rootCache.has(code)) return rootCache.get(code)!;
    let curr: string | null = findParentCode(code, codeSet);
    let last = code;
    while (curr) {
      last = curr;
      curr = findParentCode(curr, codeSet);
    }
    rootCache.set(code, last);
    return last;
  };

  for (const row of cloned) {
    const root = findRoot(row.code);
    row.rootCode = root;

    let bucket = byRootCode.get(root);
    if (!bucket) {
      bucket = [];
      byRootCode.set(root, bucket);
      rootOrder.push(root);
    }
    bucket.push(row);
  }

  return { cache: cloned, byCode, byRootCode, rootOrder };
}

export class CustomsDatabase extends Dexie {
  public customs!: Table<CustomsRecord, string>;

  constructor() {
    super("CustomsDatabaseCodesV1");
    this.version(1).stores({
      customs:
        "code, description, percentage, cefta, msa, trmtl, tvsh, excise, validFrom, uomCode",
    });
  }
}

let dbInstance: CustomsDatabase | null = null;

function getDb(): CustomsDatabase {
  if (typeof window === "undefined") {
    throw new Error("Customs database is only available in the browser.");
  }
  if (!dbInstance) {
    dbInstance = new CustomsDatabase();
  }
  return dbInstance;
}

type FlexDocHit = { id: string; highlight?: string | null };

/** tolerant extractor across flexsearch versions/shapes */
function extractFlexDocHits(raw: unknown): FlexDocHit[] {
  const hits: FlexDocHit[] = [];
  const visit = (node: unknown) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node === "string" || typeof node === "number") {
      hits.push({ id: String(node), highlight: null });
      return;
    }
    if (typeof node === "object") {
      const record = node as Record<string, unknown>;
      const rawId = record.id;
      if (typeof rawId === "string" || typeof rawId === "number") {
        let highlight: string | null = null;
        if (typeof record.highlight === "string") {
          highlight = record.highlight;
        } else {
          const doc = record.doc;
          if (
            doc &&
            typeof doc === "object" &&
            typeof (doc as { highlight?: unknown }).highlight === "string"
          ) {
            highlight = (doc as { highlight: string }).highlight;
          }
        }
        hits.push({ id: String(rawId), highlight });
      }
      const result = record.result;
      if (Array.isArray(result)) result.forEach(visit);
      const subHits = record.hits;
      if (Array.isArray(subHits)) subHits.forEach(visit);
    }
  };
  visit(raw);

  // de-dup, prefer entries that carry highlight
  const dedup = new Map<string, string | null>();
  for (const h of hits) {
    if (!dedup.has(h.id)) dedup.set(h.id, h.highlight ?? null);
    else if (!dedup.get(h.id) && h.highlight) dedup.set(h.id, h.highlight);
  }
  return Array.from(dedup, ([id, highlight]) => ({ id, highlight }));
}

export class CustomsDataService {
  private static _allDataCache: CustomsFlatRow[] | null = null;
  private static _allDataByCode: Map<string, CustomsFlatRow> | null = null;
  private static _allDataByRootCode: Map<string, CustomsFlatRow[]> | null =
    null;
  private static _rootOrder: string[] | null = null;
  private static _descriptionIndex: FlexSearchDocument | null = null;

  static resetCaches(): void {
    this._allDataCache = null;
    this._allDataByCode = null;
    this._allDataByRootCode = null;
    this._rootOrder = null;
    this._descriptionIndex = null;
  }

  static async initializeData({
    force = false,
    onProgress,
  }: InitializeOptions = {}): Promise<boolean> {
    if (typeof window === "undefined") return false;

    const formatNumber = (v: number) => v.toLocaleString(undefined);

    try {
      const db = getDb();
      const existing = await db.customs.count();
      if (!force && existing > 0) {
        this.resetCaches();
        onProgress?.({
          phase: "cached",
          loaded: existing,
          total: existing,
          message: `U gjetën ${formatNumber(existing)} rreshta ekzistues.`,
        });
        return false;
      }

      onProgress?.({
        phase: "load-data",
        loaded: 0,
        total: 0,
        message: "Duke ngarkuar të dhënat e tarifave...",
      });

      const data = (await import("@/data/tarrifs.json"))
        .default as CustomsRecord[];
      const total = data.length;

      onProgress?.({
        phase: "indexing",
        loaded: 0,
        total,
        message: `Duke indeksuar 0 / ${formatNumber(total)} rreshta...`,
      });

      // Normalize
      const normalized: CustomsRecord[] = data.map((d) => ({
        code: d.code == null ? "" : String(d.code),
        description: d.description == null ? "" : String(d.description),
        percentage: Number.isFinite(Number(d.percentage))
          ? Number(d.percentage)
          : 0,
        cefta: Number.isFinite(Number(d.cefta)) ? Number(d.cefta) : 0,
        msa: Number.isFinite(Number(d.msa)) ? Number(d.msa) : 0,
        trmtl: Number.isFinite(Number(d.trmtl)) ? Number(d.trmtl) : 0,
        tvsh: Number.isFinite(Number(d.tvsh)) ? Number(d.tvsh) : 0,
        excise: Number.isFinite(Number(d.excise)) ? Number(d.excise) : 0,
        validFrom: d.validFrom ?? "",
        uomCode: (d.uomCode ?? null) as string | null,
        fileUrl: d.fileUrl ?? null,
        importMeasure: d.importMeasure ?? null,
        exportMeasure: d.exportMeasure ?? null,
      }));

      await db.transaction("rw", db.customs, async () => {
        await db.customs.clear();
        for (let start = 0; start < normalized.length; start += INDEX_CHUNK_SIZE) {
          const chunk = normalized.slice(start, start + INDEX_CHUNK_SIZE);
          await db.customs.bulkAdd(chunk);
          const loaded = Math.min(start + chunk.length, normalized.length);
          onProgress?.({
            phase: "indexing",
            loaded,
            total,
            message: `Duke indeksuar ${formatNumber(loaded)} / ${formatNumber(
              total,
            )} rreshta...`,
          });
        }
      });

      this.resetCaches();

      onProgress?.({
        phase: "done",
        loaded: total,
        total,
        message: "Indeksimi i të dhënave u përfundua.",
      });

      return true;
    } catch (error) {
      console.error("Error initializing database:", error);
      onProgress?.({
        phase: "error",
        loaded: 0,
        total: 0,
        message: "Indeksimi dështoi. Kontrolloni konsolën për detaje.",
      });
      return false;
    }
  }

  private static async ensureAllDataCache(): Promise<CustomsFlatRow[]> {
    if (this._allDataCache) return this._allDataCache;
    if (typeof window === "undefined") return [];

    try {
      const db = getDb();
      const rows = await db.customs.toArray();
      const { cache, byCode, byRootCode, rootOrder } = buildCachedData(rows);
      this._allDataCache = cache;
      this._allDataByCode = byCode;
      this._allDataByRootCode = byRootCode;
      this._rootOrder = rootOrder;
      return this._allDataCache;
    } catch (error) {
      console.error("Error building data cache:", error);
      this._allDataCache = [];
      this._allDataByCode = new Map();
      this._allDataByRootCode = new Map();
      this._rootOrder = [];
      return this._allDataCache;
    }
  }

  private static async ensureDescriptionIndex(): Promise<FlexSearchDocument> {
    if (this._descriptionIndex) return this._descriptionIndex;

    const data = await this.ensureAllDataCache();
    const encoder = new Encoder({
      include: {
        letter: true,
        number: false,
        char: ["#", "@", "-"]
      }
    });
    const index = new FlexSearchDocument({
      document: {
        id: "code" as const,
        store: true,
        index: [
          {
            field: "description",
            tokenize: "forward" as const,
            encoder,
          },
        ],
      },
    });
    for (const row of data) {
      index.add({
        code: row.code,
        description: row.description,
      });
    }
    this._descriptionIndex = index;
    return index;
  }

  static async getAllData(): Promise<CustomsFlatRow[]> {
    try {
      const cache = await this.ensureAllDataCache();
      return cache.map((row) => ({ ...row }));
    } catch (error) {
      console.error("Error fetching all data:", error);
      return [];
    }
  }

  static buildTreeFromList(list: CustomsFlatRow[]) {
    const byCode = new Map<string, CustomsTreeNode>();
    const presentCodes = new Set(list.map((r) => r.code));
    const roots: CustomsTreeNode[] = [];

    for (const row of list) {
      byCode.set(row.code, { ...row, subRows: [] });
    }

    for (const row of list) {
      const node = byCode.get(row.code)!;
      const parentCode = findParentCode(row.code, presentCodes);
      if (parentCode && byCode.has(parentCode)) {
        byCode.get(parentCode)!.subRows.push(node);
      } else {
        roots.push(node);
      }
    }

    for (const node of byCode.values()) {
      if (node.subRows.length > 1) node.subRows.sort(sortChildren);
    }
    roots.sort(sortChildren);
    return roots;
  }

  private static readonly CODE_SEARCH_MULTIPLIER = 4;
  private static readonly DESC_SEARCH_MULTIPLIER = 6;
  private static readonly MAX_ALL_DATA_LIMIT = 10000;

  static async searchByFields(
    idPrefix = "",
    descQuery = "",
    { parentLimit = 200, itemLimit = 4000 }: SearchOptions = {},
  ): Promise<CustomsFlatRow[]> {
    if (typeof window === "undefined") return [];

    try {
      const codePrefix = (idPrefix ?? "").trim();
      const descQueryTrimmed = (descQuery ?? "").trim();
      const hasCodeQuery = codePrefix.length > 0;
      const hasDescQuery = descQueryTrimmed.length > 0;

      if (!hasCodeQuery && !hasDescQuery) {
        const allData = await this.getAllData();
        return allData.slice(0, Math.min(itemLimit, this.MAX_ALL_DATA_LIMIT));
      }

      const data = await this.ensureAllDataCache();
      if (!data.length) {
        console.warn("No data available for search");
        return [];
      }

      const codeSet = hasCodeQuery
        ? await this.searchByCodeCodes(codePrefix, parentLimit)
        : null;

      const descHits = hasDescQuery
        ? await this.searchByDescriptionHits(descQueryTrimmed, itemLimit)
        : null;

      const highlightByCode = new Map<string, string>();
      let descCodes: Set<string> | null = null;

      if (descHits) {
        descCodes = new Set();
        descHits.forEach((r) => {
          descCodes!.add(r.id);
          if (r.highlight) highlightByCode.set(r.id, r.highlight);
        });
      }

      const finalCodes = this.intersectCodes(codeSet, descCodes);
      if (!finalCodes.size) return [];

      return this.buildSearchResults(finalCodes, highlightByCode, itemLimit);
    } catch (error) {
      console.error("Search failed:", { idPrefix, descQuery, error });
      return [];
    }
  }

  private static async searchByCodeCodes(
    codePrefix: string,
    parentLimit: number,
  ): Promise<Set<string>> {
    const db = getDb();
    // Primary keys (codes) that start with the prefix
    const codes = await db.customs
      .where("code")
      .startsWith(codePrefix)
      .limit(parentLimit * this.CODE_SEARCH_MULTIPLIER)
      .primaryKeys();
    return new Set(codes as string[]);
  }

  private static async searchByDescriptionHits(
    query: string,
    itemLimit: number,
  ): Promise<FlexDocHit[]> {
    const index = await this.ensureDescriptionIndex();
    const dataLength = (await this.ensureAllDataCache()).length;
    const searchLimit =
      Math.min(itemLimit * this.DESC_SEARCH_MULTIPLIER, dataLength) || undefined;

    const raw = index.search(query, {
      limit: searchLimit,
      highlight: {
        template: FLEXSEARCH_HIGHLIGHT_TEMPLATE,
        ellipsis: "…",
      },
      enrich: true,
      pluck: "description",
    });

    return extractFlexDocHits(raw);
  }

  private static intersectCodes(
    a: Set<string> | null,
    b: Set<string> | null,
  ): Set<string> {
    if (a && b) return new Set([...a].filter((id) => b.has(id)));
    if (a) return a;
    if (b) return b;
    return new Set();
  }

  private static buildSearchResults(
    codes: Set<string>,
    highlightByCode: Map<string, string>,
    itemLimit: number,
  ): CustomsFlatRow[] {
    const byCode = this._allDataByCode;
    const byRootCode = this._allDataByRootCode;
    const rootOrder = this._rootOrder;

    if (!byCode || !byRootCode || !rootOrder) return [];

    const matchedRootCodes = new Set<string>();
    for (const code of codes) {
      const row = byCode.get(code);
      if (!row) continue;
      matchedRootCodes.add(row.rootCode ?? row.code);
    }
    if (!matchedRootCodes.size) return [];

    const results: CustomsFlatRow[] = [];
    for (const root of rootOrder) {
      if (!matchedRootCodes.has(root)) continue;
      const bucket = byRootCode.get(root);
      if (!bucket) continue;

      for (const row of bucket) {
        results.push({
          ...row,
          highlightedDescription:
            highlightByCode.get(row.code) ?? row.highlightedDescription ?? null,
        });
        if (results.length >= itemLimit) return results;
      }
    }
    return results;
  }
}