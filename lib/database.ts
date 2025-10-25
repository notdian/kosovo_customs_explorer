import Dexie, { Table } from "dexie";
import MiniSearch from "minisearch";

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

const MINISEARCH_HIGHLIGHT_TEMPLATE =
  '<span class="bg-amber-200 rounded px-0.5">$&</span>';
const INDEX_CHUNK_SIZE = 2_000;

function compareRecords(a: CustomsRecord, b: CustomsRecord): number {
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

type MiniSearchHit = { id: string; highlight?: string | null };

export class CustomsDataService {
  private static _descriptionIndex: MiniSearch | null = null;

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

      // Rebuild index after data load
      await this.ensureDescriptionIndex();

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

  private static async ensureDescriptionIndex(): Promise<MiniSearch> {
    if (this._descriptionIndex) return this._descriptionIndex;

    const db = getDb();
    const data = await db.customs.orderBy("code").toArray();

    const index = new MiniSearch({
      fields: ["description"],
      storeFields: ["description"],
      idField: "code",
      extractField: (doc, fieldName) => doc[fieldName] || "",
      searchOptions: {
        fuzzy: false,
        prefix: true,
      },
    });

    index.addAll(data.map((row) => ({
      code: row.code,
      description: row.description,
    })));

    this._descriptionIndex = index;
    return index;
  }

  static async getAllData(): Promise<CustomsFlatRow[]> {
    try {
      const db = getDb();
      const rows = await db.customs.orderBy("code").toArray();
      return rows.map((row) => ({ ...row }));
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
      if (node.subRows.length > 1) node.subRows.sort(compareRecords);
    }
    roots.sort(compareRecords);
    return roots;
  }

  private static async findExistingParent(db: CustomsDatabase, code: string): Promise<string | null> {
    for (let i = code.length - 1; i > 0; i--) {
      const cand = code.slice(0, i);
      const rec = await db.customs.get(cand);
      if (rec) return cand;
    }
    return null;
  }

  private static async getLowestExistingAncestor(db: CustomsDatabase, prefix: string): Promise<string | null> {
    let curr: string | null = prefix;
    while (curr && curr.length > 0) {
      const rec = await db.customs.get(curr);
      if (rec) return curr;
      curr = await this.findExistingParent(db, curr);
    }
    return null;
  }

  private static async getPath(db: CustomsDatabase, target: string): Promise<string[]> {
    const path: string[] = [target];
    let curr = target;
    while (true) {
      const parent = await this.findExistingParent(db, curr);
      if (!parent) break;
      path.unshift(parent);
      curr = parent;
    }
    return path;
  }

  private static async getDirectChildrenRecords(
    db: CustomsDatabase,
    parentCode: string,
  ): Promise<CustomsRecord[]> {
    const candidates = await db.customs.where("code").startsWith(parentCode).toArray();
    if (candidates.length === 0) return [];

    const codeSet = new Set(candidates.map((record) => record.code));
    const children = candidates.filter((record) => {
      if (record.code === parentCode) return false;
      return findParentCode(record.code, codeSet) === parentCode;
    });

    return children
      .map((record) => ({ ...record }))
      .sort(compareRecords);
  }

  private static async getSubtreeWithAncestors(target: string): Promise<CustomsFlatRow[]> {
    const db = getDb();
    const subtree = await db.customs.where("code").startsWith(target).toArray();
    if (subtree.length === 0) return [];

    const lca = await this.getLowestExistingAncestor(db, target);
    const pathToLca = lca ? await this.getPath(db, lca) : [];
    const allRecords = new Map<string, CustomsRecord>();
    const addRecord = (record: CustomsRecord | null | undefined) => {
      if (!record) return;
      if (allRecords.has(record.code)) return;
      allRecords.set(record.code, { ...record });
    };

    subtree.forEach((record) => addRecord(record));

    const ancestorRecords = await Promise.all(pathToLca.map((code) => db.customs.get(code)));
    ancestorRecords.forEach((record) => addRecord(record));

    const parentsForSiblings = new Set<string>();
    for (const code of pathToLca) {
      const parent = await this.findExistingParent(db, code);
      if (parent) parentsForSiblings.add(parent);
    }

    for (const parentCode of parentsForSiblings) {
      const directChildren = await this.getDirectChildrenRecords(db, parentCode);
      directChildren.forEach((record) => addRecord(record));
    }

    return Array.from(allRecords.values()).sort(compareRecords);
  }

  private static async getSubtreesForHits(
    codes: string[],
    hits: MiniSearchHit[],
  ): Promise<CustomsFlatRow[]> {
    const highlightMap = new Map(hits.map((h) => [h.id, h.highlight || null]));
    const allRecords = new Map<string, CustomsRecord>();

    const subtrees = await Promise.all(
      codes.map((code) => this.getSubtreeWithAncestors(code)),
    );

    for (const subtree of subtrees) {
      for (const record of subtree) {
        if (!allRecords.has(record.code)) {
          allRecords.set(record.code, { ...record });
        }
      }
    }

    for (const [code, record] of allRecords) {
      const hl = highlightMap.get(code);
      if (hl) record.highlightedDescription = hl;
    }

    return Array.from(allRecords.values()).sort(compareRecords);
  }

  private static async searchByDescriptionHits(
    query: string,
  ): Promise<MiniSearchHit[]> {
    const index = await this.ensureDescriptionIndex();
    const results = index.search(query, {
      prefix: true,
      fuzzy: false,
    });

    return results.map((result) => {
      let highlight: string | null = null;
      if (result.terms) {
        let description = result.description || "";
        result.terms.forEach((term) => {
          const regex = new RegExp(`\\b${term}\\b`, "gi");
          description = description.replace(regex, MINISEARCH_HIGHLIGHT_TEMPLATE);
        });

        highlight = description;
      }
      return { id: result.id, highlight };
    });
  }

  static async searchByFields(
    idPrefix = "",
    descQuery = "",
  ): Promise<CustomsFlatRow[]> {
    if (typeof window === "undefined") return [];
    const codePrefix = (idPrefix ?? "").trim();
    const descQueryTrimmed = (descQuery ?? "").trim();
    const hasCodeQuery = codePrefix.length > 0;
    const hasDescQuery = descQueryTrimmed.length > 0;
    try {
      if (!hasCodeQuery && !hasDescQuery) {
        return await this.getAllData();
      }

      if (!hasDescQuery) {
        return await this.getSubtreeWithAncestors(codePrefix);
      }

      const hits = await this.searchByDescriptionHits(descQueryTrimmed);
      const relevantHits = hasCodeQuery
        ? hits.filter((h) => h.id.startsWith(codePrefix))
        : hits;

      if (relevantHits.length === 0) {
        return hasCodeQuery
          ? await this.getSubtreeWithAncestors(codePrefix)
          : [];
      }

      return await this.getSubtreesForHits(relevantHits.map((h) => h.id), relevantHits);
    } catch (error) {
      console.error("Search failed:", { idPrefix, descQuery, error });
      return [];
    }
  }
}
