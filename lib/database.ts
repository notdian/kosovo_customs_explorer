import Dexie, { Table } from "dexie";
import { Charset, Encoder, Document as FlexSearchDocument } from "flexsearch";

export interface CustomsRecord {
  id: number;
  parentId: number | null;
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
  fileUrl: string | null;
  importMeasure: string | null;
  exportMeasure: string | null;
  rootId?: number | null;
  highlightedDescription?: string | null;
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

function sortChildren(a: CustomsTreeNode, b: CustomsTreeNode): number {
  const ac = (a.code ?? "").toString();
  const bc = (b.code ?? "").toString();
  if (ac < bc) return -1;
  if (ac > bc) return 1;
  const ad = (a.description ?? "").toString();
  const bd = (b.description ?? "").toString();
  if (ad < bd) return -1;
  if (ad > bd) return 1;
  return (a.id ?? 0) - (b.id ?? 0);
}

function buildCachedData(rows: CustomsRecord[]): {
  cache: CustomsFlatRow[];
  byId: Map<number, CustomsFlatRow>;
  byRootId: Map<number, CustomsFlatRow[]>;
  rootOrder: number[];
} {
  const cloned: CustomsFlatRow[] = rows.map((row) => ({ ...row }));
  const byId = new Map<number, CustomsFlatRow>(
    cloned.map((row) => [row.id, row]),
  );
  const rootCache = new Map<number, number | null>();
  const byRootId = new Map<number, CustomsFlatRow[]>();
  const rootOrder: number[] = [];

  const findRootId = (row: CustomsFlatRow | undefined): number | null => {
    if (!row) return null;
    const cached = rootCache.get(row.id);
    if (cached !== undefined) return cached;
    if (!row.parentId) {
      rootCache.set(row.id, row.id);
      return row.id;
    }
    const parent = byId.get(row.parentId);
    const rootId = findRootId(parent) ?? row.parentId;
    rootCache.set(row.id, rootId);
    return rootId;
  };

  for (const row of cloned) {
    row.rootId = findRootId(row) ?? row.id;
    const rootId = row.rootId ?? row.id;
    let bucket = byRootId.get(rootId);
    if (!bucket) {
      bucket = [];
      byRootId.set(rootId, bucket);
      rootOrder.push(rootId);
    }
    bucket.push(row);
  }

  return { cache: cloned, byId, byRootId, rootOrder };
}

export class CustomsDatabase extends Dexie {
  public customs!: Table<CustomsRecord, number>;

  constructor() {
    super("CustomsDatabaseV2");
    this.version(1).stores({
      customs:
        "++id, code, parentId, description, percentage, cefta, msa, trmtl, tvsh, excise, validFrom, uomCode",
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

type FlexDocHit = { id: number; highlight?: string | null };

function extractFlexDocHits(raw: unknown): FlexDocHit[] {
  // Tolerant extractor across flexsearch versions/shapes
  const hits: FlexDocHit[] = [];
  const visit = (node: unknown) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node === "number") {
      hits.push({ id: node, highlight: null });
      return;
    }
    if (typeof node === "object") {
      const record = node as Record<string, unknown>;
      const rawId = record.id;
      if (typeof rawId === "number") {
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
        hits.push({ id: rawId, highlight });
      }
      const result = record.result;
      if (Array.isArray(result)) {
        result.forEach(visit);
      }
      const subHits = record.hits;
      if (Array.isArray(subHits)) {
        subHits.forEach(visit);
      }
    }
  };
  visit(raw);

  const dedup = new Map<number, string | null>();
  for (const h of hits) {
    if (!dedup.has(h.id)) dedup.set(h.id, h.highlight ?? null);
    else if (!dedup.get(h.id) && h.highlight) dedup.set(h.id, h.highlight);
  }
  return Array.from(dedup, ([id, highlight]) => ({ id, highlight }));
}

export class CustomsDataService {
  private static _allDataCache: CustomsFlatRow[] | null = null;
  private static _allDataById: Map<number, CustomsFlatRow> | null = null;
  private static _allDataByRootId: Map<number, CustomsFlatRow[]> | null = null;
  private static _rootOrder: number[] | null = null;
  private static _descriptionIndex: FlexSearchDocument | null = null;

  static resetCaches(): void {
    this._allDataCache = null;
    this._allDataById = null;
    this._allDataByRootId = null;
    this._rootOrder = null;
    this._descriptionIndex = null;
  }

  static async initializeData({
    force = false,
    onProgress,
  }: InitializeOptions = {}): Promise<boolean> {
    if (typeof window === "undefined") {
      return false;
    }

    const formatNumber = (value: number) => value.toLocaleString(undefined);

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

      const normalized: CustomsRecord[] = data.map((d) => ({
        ...d,
        code: d.code == null ? "" : String(d.code),
        description: d.description == null ? "" : String(d.description),
        importMeasure: d.importMeasure ?? null,
        exportMeasure: d.exportMeasure ?? null,
        fileUrl: d.fileUrl ?? null,
        validFrom: d.validFrom ?? "",
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
      const { cache, byId, byRootId, rootOrder } = buildCachedData(rows);
      this._allDataCache = cache;
      this._allDataById = byId;
      this._allDataByRootId = byRootId;
      this._rootOrder = rootOrder;
      return this._allDataCache;
    } catch (error) {
      console.error("Error building data cache:", error);
      this._allDataCache = [];
      this._allDataById = new Map();
      this._allDataByRootId = new Map();
      this._rootOrder = [];
      return this._allDataCache;
    }
  }

  private static async ensureDescriptionIndex(): Promise<FlexSearchDocument> {
    if (this._descriptionIndex) return this._descriptionIndex;

    const data = await this.ensureAllDataCache();
    const encoder = new Encoder(Charset.Normalize);
    const index = new FlexSearchDocument({
      document: {
        id: "id" as const,
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
        id: row.id,
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
    const byId = new Map<number, CustomsTreeNode>();
    const roots: CustomsTreeNode[] = [];

    for (const row of list) {
      const node: CustomsTreeNode = { ...row, subRows: [] };
      byId.set(node.id, node);
    }

    for (const row of list) {
      const node = byId.get(row.id);
      if (!node) continue;
      if (row.parentId == null || !byId.has(row.parentId)) {
        roots.push(node);
      } else {
        byId.get(row.parentId)?.subRows.push(node);
      }
    }

    for (const node of byId.values()) {
      if (node.subRows.length > 1) {
        node.subRows.sort(sortChildren);
      }
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
    if (typeof window === "undefined") {
      return [];
    }

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

      const codeIds = hasCodeQuery
        ? await this.searchByCodeIds(codePrefix, parentLimit)
        : null;

      const descHits = hasDescQuery
        ? await this.searchByDescriptionHits(descQueryTrimmed, itemLimit)
        : null;

      const highlightById = new Map<number, string>();

      let descIds: Set<number> | null = null;

      if (descHits) {
        descIds = new Set();
        descHits.forEach((r) => {
          descIds!.add(r.id as number);
          if (r.highlight) highlightById.set(r.id as number, r.highlight);
        });
      }

      const finalIds = this.intersectIds(codeIds, descIds);
      if (!finalIds.size) return [];

      return this.buildSearchResults(finalIds, highlightById, itemLimit);
    } catch (error) {
      console.error("Search failed:", { idPrefix, descQuery, error });
      return [];
    }
  }

  private static async searchByCodeIds(
    codePrefix: string,
    parentLimit: number,
  ): Promise<Set<number>> {
    const db = getDb();
    // Grab primary keys of rows whose code starts with the prefix
    const ids = await db.customs
      .where("code")
      .startsWith(codePrefix)
      .limit(parentLimit * this.CODE_SEARCH_MULTIPLIER)
      .primaryKeys();

    return new Set(ids);
  }

  private static async searchByDescriptionHits(
    query: string,
    itemLimit: number,
  ): Promise<FlexDocHit[]> {
    const index = await this.ensureDescriptionIndex();
    const dataLength = (await this.ensureAllDataCache()).length;
    const searchLimit =
      Math.min(itemLimit * this.DESC_SEARCH_MULTIPLIER, dataLength) || undefined;

    // Ask for enriched results to maximize compatibility with highlight plugins
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

  private static intersectIds(
    a: Set<number> | null,
    b: Set<number> | null,
  ): Set<number> {
    if (a && b) return new Set([...a].filter((id) => b.has(id)));
    if (a) return a;
    if (b) return b;
    return new Set();
  }

  private static buildSearchResults(
    ids: Set<number>,
    highlightById: Map<number, string>,
    itemLimit: number,
  ): CustomsFlatRow[] {
    const byId = this._allDataById;
    const byRootId = this._allDataByRootId;
    const rootOrder = this._rootOrder;

    if (!byId || !byRootId || !rootOrder) {
      return [];
    }

    const matchedRootIds = new Set<number>();

    for (const id of ids) {
      const row = byId.get(id);
      if (!row) continue;
      matchedRootIds.add(row.rootId ?? row.id);
    }

    if (!matchedRootIds.size) {
      return [];
    }

    const results: CustomsFlatRow[] = [];

    for (const rootId of rootOrder) {
      if (!matchedRootIds.has(rootId)) continue;
      const rowsForRoot = byRootId.get(rootId);
      if (!rowsForRoot) continue;

      for (const row of rowsForRoot) {
        results.push({
          ...row,
          highlightedDescription:
            highlightById.get(row.id) ?? row.highlightedDescription ?? null,
        });

        if (results.length >= itemLimit) {
          return results;
        }
      }
    }

    return results;
  }
}
