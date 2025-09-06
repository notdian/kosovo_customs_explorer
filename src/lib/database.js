// lib/database.js
import Dexie from "dexie";
export class CustomsDatabase extends Dexie {
  constructor() {
    super("CustomsDatabase");
    this.version(5).stores({
      customs:
        "++id," +
        "code, description, parentId, percentage, cefta, msa, trmtl, tvsh, excise, validFrom, uomCode," +
        "codeLC, descLC, descValLC",
      parents: "rootId, codeLC, titleLC, isRoot, terms*",
      agg: null,
    });
  }
}
export const db = new CustomsDatabase();
const intersectById = (arrays) => {
  if (!arrays.length) return [];
  return arrays.reduce((acc, current) => {
    const ids = new Set(current.map((x) => x.id));
    return acc.filter((x) => ids.has(x.id));
  });
};
function normalizeLC(str) {
  return (str ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}
const tokenize = (q) => {
  const norm = normalizeLC(q);
  const matches = norm.match(/"([^"]+)"|\S+/g) || [];
  return matches.map((t) => t.replace(/^"|"$/g, "")).filter(Boolean);
};
const tokensFrom = (text) => {
  const s = normalizeLC(text);
  const toks = s.match(/[a-z0-9]+/g) || [];
  return toks.filter(Boolean);
};
/* ----------------------- tree helpers (pure) ----------------------- */
function sortChildren(a, b) {
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
function buildTreeFromList(list) {
  const byId = new Map();
  const roots = [];
  for (const r of list) byId.set(r.id, { ...r, subRows: [] });
  for (const r of list) {
    const node = byId.get(r.id);
    if (!r.parentId || !byId.has(r.parentId)) roots.push(node);
    else byId.get(r.parentId).subRows.push(node);
  }
  for (const node of byId.values())
    if (node.subRows?.length) node.subRows.sort(sortChildren);
  roots.sort(sortChildren);
  return roots;
}
/* ----------------------- parents (roots) index ----------------------- */
function buildParentsIndex(customsList) {
  const byId = new Map();
  const children = new Map();
  for (const row of customsList) {
    byId.set(row.id, row);
    if (row.parentId) {
      if (!children.has(row.parentId)) children.set(row.parentId, []);
      children.get(row.parentId).push(row);
    }
  }
  const roots = [];
  for (const row of customsList) {
    if (!row.parentId || !byId.has(row.parentId)) roots.push(row);
  }
  const collectForRoot = (root) => {
    const stack = [root];
    const idList = [];
    const tokenBag = [];
    while (stack.length) {
      const cur = stack.pop();
      if (!cur) continue;
      idList.push(cur.id);
      tokenBag.push(
        ...tokensFrom(cur.codeLC),
        ...tokensFrom(cur.descLC),
        ...tokensFrom(cur.descValLC),
      );
      const kids = children.get(cur.id) ?? [];
      for (let i = 0; i < kids.length; i++) stack.push(kids[i]);
    }
    return { idList, uniqTokens: [...new Set(tokenBag.filter(Boolean))] };
  };
  return roots.map((root) => {
    const { idList, uniqTokens } = collectForRoot(root);
    return {
      rootId: root.id,
      isRoot: true,
      codeLC: root.codeLC ?? "",
      titleLC: root.descLC ?? "",
      terms: uniqTokens,
      childIds: idList, // not indexed
    };
  });
}
/* ----------------------- service ----------------------- */
export class CustomsDataService {
  static async initializeData({ force = false } = {}) {
    try {
      const existing = await db.customs.count();
      if (!force && existing > 0) {
        const parentsCount = await db.parents.count().catch(() => 0);
        if (parentsCount === 0) await this.rebuildParentsIndex();
        return false;
      }
      const { default: data } = await import("@/data/tarrifs.json", {
        type: "json",
      });
      const normalized = data.map((d) => ({
        ...d,
        codeLC: normalizeLC(d.code),
        descLC: normalizeLC(d.description),
        descValLC: normalizeLC(d.descriptionValue),
      }));
      await db.transaction("rw", db.customs, db.parents, async () => {
        await db.customs.clear();
        await db.parents.clear();
        await db.customs.bulkAdd(normalized);
        const parents = buildParentsIndex(normalized);
        await db.parents.bulkPut(parents);
      });
      return true;
    } catch (error) {
      console.error("Error initializing database:", error);
      return false;
    }
  }
  static async rebuildParentsIndex() {
    try {
      const all = await db.customs.toArray();
      const parents = buildParentsIndex(all);
      await db.transaction("rw", db.parents, async () => {
        await db.parents.clear();
        await db.parents.bulkPut(parents);
      });
    } catch (e) {
      console.error("Error rebuilding parents index:", e);
    }
  }
  static async getAllData() {
    try {
      return await db.customs.toArray();
    } catch (error) {
      console.error("Error fetching all data:", error);
      return [];
    }
  }
  static buildTreeFromList(list) {
    return buildTreeFromList(list);
  }
  /**
   * Dual-field search:
   * - idPrefix: prefix match against code/id tokens (via parents.terms + codeLC)
   * - descQuery: AND across tokens against parents.terms
   * Returns all rows from matching roots; UI builds the tree.
   */
  static async searchByFields(
    idPrefix = "",
    descQuery = "",
    { parentLimit = 200, itemLimit = 4000 } = {},
  ) {
    try {
      const idP = normalizeLC((idPrefix ?? "").trim());
      const desc = normalizeLC((descQuery ?? "").trim());
      if (!idP && !desc) return this.getAllData();
      // Gather roots by id/code prefix
      let rootsById = null;
      if (idP) {
        const [byCode, byTerms] = await Promise.all([
          db.parents
            .where("codeLC")
            .startsWith(idP)
            .limit(parentLimit * 2)
            .toArray(),
          db.parents
            .where("terms")
            .startsWith(idP)
            .limit(parentLimit * 4)
            .toArray(),
        ]);
        const map = new Map();
        for (const r of byCode) map.set(r.rootId, r);
        for (const r of byTerms) map.set(r.rootId, r);
        rootsById = [...map.values()];
      }
      // Gather roots by description tokens (AND)
      let rootsByDesc = null;
      if (desc) {
        const tokens = tokenize(desc);
        if (tokens.length) {
          const perToken = [];
          for (const t of tokens) {
            const rs = await db.parents
              .where("terms")
              .startsWith(t)
              .limit(parentLimit * 4)
              .toArray();
            perToken.push(rs);
          }
          rootsByDesc =
            perToken.length > 1
              ? intersectById(
                  perToken.map((arr) => arr.map((r) => ({ id: r.rootId }))),
                )
                  .map((x) => perToken[0].find((r) => r.rootId === x.id))
                  .filter(Boolean)
              : perToken[0] || [];
        } else {
          rootsByDesc = [];
        }
      }
      // Combine filters
      let roots = [];
      if (rootsById && rootsByDesc) {
        const ids = new Set(rootsByDesc.map((r) => r.rootId));
        roots = rootsById.filter((r) => ids.has(r.rootId));
      } else if (rootsById) {
        roots = rootsById;
      } else if (rootsByDesc) {
        roots = rootsByDesc;
      }
      if (!roots.length) return [];
      // Collect all descendant ids from matching roots
      const idSet = new Set();
      for (const r of roots.slice(0, parentLimit)) {
        for (const id of r.childIds ?? []) idSet.add(id);
      }
      const rows = (await db.customs.bulkGet([...idSet])).filter(Boolean);
      return rows.slice(0, itemLimit);
    } catch (error) {
      console.error("Dual-field search error:", error);
      return [];
    }
  }
}
