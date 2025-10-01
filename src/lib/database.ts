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

const FLEXSEARCH_HIGHLIGHT_TEMPLATE =
  '<span class="bg-amber-200 rounded px-0.5">$1</span>';

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
    cloned.map((row) => [row.id, row])
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

export const db = new CustomsDatabase();

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
  }: { force?: boolean } = {}): Promise<boolean> {
    try {
      const existing = await db.customs.count();
      if (!force && existing > 0) {
        this.resetCaches();
        return false;
      }
      const data = (await import("@/data/tarrifs.json"))
        .default as CustomsRecord[];
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
        await db.customs.bulkAdd(normalized);
      });
      this.resetCaches();
      return true;
    } catch (error) {
      console.error("Error initializing database:", error);
      return false;
    }
  }

  private static async ensureAllDataCache(): Promise<CustomsFlatRow[]> {
    if (this._allDataCache) return this._allDataCache;

    try {
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

  private static readonly CODE_SEARCH_MULTIPLIER = 4; // Fetch more codes to ensure enough roots after intersection
  private static readonly DESC_SEARCH_MULTIPLIER = 6; // Over-fetch descriptions for roots
  private static readonly MAX_ALL_DATA_LIMIT = 10000; // Cap "all data" fallback to prevent overload

  static async searchByFields(
    idPrefix = "",
    descQuery = "",
    { parentLimit = 200, itemLimit = 4000 }: SearchOptions = {}
  ): Promise<CustomsFlatRow[]> {
    try {
      const codePrefix = (idPrefix ?? "").trim();
      const descQueryTrimmed = (descQuery ?? "").trim();
      const hasCodeQuery = codePrefix.length > 0;
      const hasDescQuery = descQueryTrimmed.length > 0;

      if (!hasCodeQuery && !hasDescQuery) {
        // Edge case: no queries -> return limited all data
        const allData = await this.getAllData();
        return allData.slice(0, Math.min(itemLimit, this.MAX_ALL_DATA_LIMIT));
      }

      const data = await this.ensureAllDataCache();
      if (!data.length) {
        console.warn("No data available for search");
        return [];
      }

      const codeIds = hasCodeQuery
        ? await this.searchByCodeRoots(codePrefix, parentLimit)
        : null;
      const descSearchResults = hasDescQuery
        ? await this.searchByDescriptionRoots(descQueryTrimmed, itemLimit)
        : null;
      const highlightById = new Map<number, string>();

      let descIds: Set<number> | null = null;

      if (descSearchResults) {
        descIds = new Set();
        descSearchResults.forEach((r) => {
          descIds!.add(r.id as number);
          if (r.highlight) highlightById.set(r.id as number, r.highlight);
        });
      }

      const finalIds = this.intersectAndLimit(codeIds, descIds);

      if (!finalIds.size) {
        return [];
      }

      return this.buildSearchResults(finalIds, highlightById, itemLimit);
    } catch (error) {
      console.error("Search failed:", { idPrefix, descQuery, error });
      return [];
    }
  }

  private static async searchByCodeRoots(
    codePrefix: string,
    parentLimit: number
  ): Promise<Set<number>> {
    const rootIds = await db.customs
      .where("code")
      .startsWith(codePrefix)
      .limit(parentLimit * this.CODE_SEARCH_MULTIPLIER)
      .primaryKeys();

    return new Set(rootIds);
  }

  private static async searchByDescriptionRoots(
    query: string,
    itemLimit: number
  ) {
    const index = await this.ensureDescriptionIndex();
    const dataLength = (await this.ensureAllDataCache()).length;
    const searchLimit =
      Math.min(itemLimit * this.DESC_SEARCH_MULTIPLIER, dataLength) ||
      undefined;

    return index.search(query, {
      limit: searchLimit,

      highlight: {
        template: FLEXSEARCH_HIGHLIGHT_TEMPLATE,
        ellipsis: "…",
      },
      pluck: "description", // Fetch only description to optimize
    });
  }

  private static intersectAndLimit(
    codeRootIds: Set<number> | null,
    descRootIds: Set<number> | null
  ): Set<number> {
    let finalIds: Set<number>;

    if (codeRootIds && descRootIds) {
      // Intersect: only roots matching both
      finalIds = new Set([...codeRootIds].filter((id) => descRootIds.has(id)));
    } else if (codeRootIds) {
      finalIds = codeRootIds;
    } else if (descRootIds) {
      finalIds = descRootIds;
    } else {
      return new Set();
    }

    if (finalIds.size === 0) return new Set();
    return finalIds;
  }

  private static buildSearchResults(
    ids: Set<number>,
    highlightById: Map<number, string>,
    itemLimit: number
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
