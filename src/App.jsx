import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { CustomsDataService } from "@/lib/database";
import "./App.css";
/* global __BUILD_TIME__ */
import {
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
/* ----------------------- small helpers ----------------------- */
function formatPercent(val) {
  if (val === null || val === undefined || Number.isNaN(Number(val)))
    return "—";
  return `${val}%`;
}
function formatDate(d) {
  try {
    const dt = new Date(d);
    return Number.isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString();
  } catch {
    return "—";
  }
}
function formatMoney(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
  try {
    return Number(n).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    return String(n);
  }
}
function ExpandIcon({ expanded }) {
  return (
    <span aria-hidden className="inline-block w-3 text-center">
      {expanded ? "▾" : "▸"}
    </span>
  );
}
function highlightPrefix(text, prefix) {
  const t = (text ?? "").toString();
  const p = (prefix ?? "").toString();
  if (!t || !p) return t || "—";
  const tLC = t.toLowerCase();
  const pLC = p.toLowerCase();
  if (!tLC.startsWith(pLC)) return t;
  const head = t.slice(0, p.length);
  const tail = t.slice(p.length);
  return (
    <>
      <span className="bg-amber-200 rounded px-0.5">{head}</span>
      {tail}
    </>
  );
}
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function tokenize(q) {
  const matches = (q ?? "").toLowerCase().match(/"([^"]+)"|\S+/g) || [];
  return matches.map((t) => t.replace(/^"|"$/g, "")).filter(Boolean);
}
function highlightMatches(text, query) {
  const t = (text ?? "").toString();
  if (!t || !query) return t || "—";
  const tokens = tokenize(query);
  if (!tokens.length) return t;
  const escaped = tokens.map(escapeRegExp);
  const regex = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts = [];
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(t)) !== null) {
    const before = t.slice(lastIndex, match.index);
    if (before) parts.push(before);
    parts.push(
      <span key={parts.length} className="bg-amber-200 rounded px-0.5">
        {match[0]}
      </span>,
    );
    lastIndex = match.index + match[0].length;
  }
  const after = t.slice(lastIndex);
  if (after) parts.push(after);
  return <>{parts}</>;
}
/* ----------------------- table ----------------------- */
function VirtualizedTreeTable({
  columns,
  data,
  loading,
  autoExpandAll = true,
  idPrefix = "",
  descQuery = "",
  price = 0,
}) {
  const table = useReactTable({
    data,
    columns,
    getRowId: (row) => String(row.id),
    getSubRows: (row) => row.subRows ?? [],
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    meta: { price, idPrefix, descQuery },
  });
  useEffect(() => {
    if (autoExpandAll) table.toggleAllRowsExpanded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  const parentRef = useRef(null);
  const rows = table.getRowModel().rows;
  const gridTemplate =
    "minmax(160px,1fr) minmax(600px,1.6fr) 50px 50px 50px 50px 50px 50px 120px 50px";
  const minTableWidth =
    170 +
    gridTemplate
      .matchAll(/(\d+)px/g)
      .map((x) => x[1])
      .reduce((a, b) => a + Number(b), 0);
  const rowVirtualizer = useVirtualizer({
    count: loading ? 1 : rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 12,
    // keep items stable when expanding/collapsing
    getItemKey: (index) => rows[index]?.id ?? index,
    // allow variable heights if a row wraps lines
    measureElement: (el) => el.getBoundingClientRect().height,
  });
  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();
  return (
    <div className="border rounded-lg overflow-hidden">
      {/* ONE horizontal scroller for header + body */}
      <div className="overflow-x-auto">
        <div style={{ minWidth: minTableWidth }}>
          <div
            className="grid bg-gray-100 p-3 font-semibold gap-4 text-sm sticky top-0 z-10"
            style={{ gridTemplateColumns: gridTemplate }}
          >
            {table
              .getHeaderGroups()
              .map((hg) =>
                hg.headers.map((header) => (
                  <div key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </div>
                )),
              )}
          </div>
          {/* Vertical scroller for virtualization */}
          <div
            ref={parentRef}
            className="relative"
            style={{
              maxHeight: "calc(100vh - 200px)",
              overflowY: "auto",
              scrollbarGutter: "stable both-edges",
            }}
          >
            <div style={{ height: totalSize, position: "relative" }}>
              {loading ? (
                <div
                  className="grid p-3 gap-4 text-sm border-b animate-pulse"
                  style={{
                    gridTemplateColumns: gridTemplate,
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 56,
                  }}
                >
                  {/* Keep a simple single-row skeleton */}
                  <div className="col-span-full h-4 w-48 bg-gray-200 rounded" />
                </div>
              ) : (
                virtualItems.map((vi) => {
                  const row = rows[vi.index];
                  if (!row) return null;
                  return (
                    <div
                      key={row.id}
                      data-index={vi.index}
                      ref={rowVirtualizer.measureElement}
                      className="grid p-3 gap-4 text-sm border-b hover:bg-gray-50"
                      style={{
                        gridTemplateColumns: gridTemplate,
                        position: "absolute",
                        top: 0,
                        left: 0,
                        right: 0,
                        transform: `translateY(${vi.start}px)`,
                        height: vi.size, // keeps the absolute item sized correctly
                      }}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <div key={cell.id} className="min-w-0">
                          {flexRender(cell.column.columnDef.cell, {
                            ...cell.getContext(),
                            row,
                          })}
                        </div>
                      ))}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
function App() {
  const [treeData, setTreeData] = useState([]);
  const [loading, setLoading] = useState(true);
  // separate queries
  const [idQuery, setIdQuery] = useState("");
  const [descQuery, setDescQuery] = useState("");
  // product price (affects duties)
  const [priceInput, setPriceInput] = useState("");
  const price = useMemo(() => {
    const n = Number((priceInput || "").toString().replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [priceInput]);
  // Init
  useEffect(() => {
    (async () => {
      try {
        await CustomsDataService.initializeData({ force: false });
        const all = await CustomsDataService.getAllData();
        setTreeData(CustomsDataService.buildTreeFromList(all));
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);
  // Debounced dual-field search
  useEffect(() => {
    const id = setTimeout(async () => {
      try {
        setLoading(true);
        const idPref = (idQuery ?? "").trim();
        const desc = (descQuery ?? "").trim();
        if (!idPref && !desc) {
          const all = await CustomsDataService.getAllData();
          setTreeData(CustomsDataService.buildTreeFromList(all));
        } else {
          const narrowed = await CustomsDataService.searchByFields(
            idPref,
            desc,
            {
              parentLimit: 200,
              itemLimit: 4000,
            },
          );
          setTreeData(CustomsDataService.buildTreeFromList(narrowed));
        }
      } catch (e) {
        console.error("Search error:", e);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(id);
  }, [idQuery, descQuery]);
  // Columns (includes duties)
  const columns = useMemo(
    () => [
      {
        header: "Kodi",
        id: "code",
        accessorFn: (row) => row.code,
        cell: (info) => {
          const row = info.row;
          const value = (info.getValue() ?? "").toString();
          const p = info?.table?.options?.meta?.idPrefix ?? "";
          const canExpand = row.getCanExpand();
          const isExpanded = row.getIsExpanded();
          return (
            <div className="flex items-start gap-2 min-w-0">
              {canExpand ? (
                <button
                  onClick={row.getToggleExpandedHandler()}
                  aria-label={isExpanded ? "Tkurre" : "Zgjero"}
                  className="shrink-0 text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded"
                  style={{ marginLeft: row.depth * 12 }}
                >
                  <ExpandIcon expanded={isExpanded} />
                </button>
              ) : (
                <span style={{ width: 18, marginLeft: row.depth * 12 }} />
              )}
              <span
                className="font-mono truncate"
                title={`#${info.row.original.id}`}
              >
                {p ? highlightPrefix(value, p) : value || "—"}
              </span>
            </div>
          );
        },
      },
      {
        header: "Përshkrimi",
        id: "description",
        accessorKey: "description",
        cell: (info) => {
          const v = info.getValue();
          const q = info?.table?.options?.meta?.descQuery ?? "";
          return (
            <div
              className="break-words hyphens-auto truncate overflow-hidden"
              lang="sq"
              title={v}
            >
              {highlightMatches(v, q)}
            </div>
          );
        },
      },
      {
        header: "Bazë",
        accessorKey: "percentage",
        cell: (i) => <span>{formatPercent(i.getValue())}</span>,
      },
      {
        header: "CEFTA",
        accessorKey: "cefta",
        cell: (i) => <span>{formatPercent(i.getValue())}</span>,
      },
      {
        header: "MSA",
        accessorKey: "msa",
        cell: (i) => <span>{formatPercent(i.getValue())}</span>,
      },
      {
        header: "TRMTL",
        accessorKey: "trmtl",
        cell: (i) => <span>{formatPercent(i.getValue())}</span>,
      },
      {
        header: "TVSH",
        accessorKey: "tvsh",
        cell: (i) => <span>{formatPercent(i.getValue())}</span>,
      },
      {
        header: "Aksizë",
        accessorKey: "excise",
        cell: (i) => <span>{formatPercent(i.getValue())}</span>,
      },
      {
        header: "E vlefshme nga",
        accessorKey: "validFrom",
        cell: (info) => (
          <span className="text-xs">{formatDate(info.getValue())}</span>
        ),
      },
      {
        header: "Detyrime",
        id: "duties",
        accessorFn: (row) => row.id,
        cell: (info) => {
          const r = info.row.original;
          const base = Number(r.percentage ?? 0) || 0;
          const tvsh = Number(r.tvsh ?? 0) || 0;
          const exc = Number(r.excise ?? 0) || 0;
          const p = info?.table?.options?.meta?.price ?? 0;
          const amt = p && p > 0 ? (p * (base + tvsh + exc)) / 100 : 0;
          return <span className="font-medium">{formatMoney(amt)}</span>;
        },
      },
    ],
    [],
  );
  const lastUpdated = useMemo(() => {
    try {
      return __BUILD_TIME__ ? new Date(__BUILD_TIME__) : null;
    } catch {
      return null;
    }
  }, []);
  return (
    <div className="min-h-screen bg-background p-4 sm:p-6">
      <h1 className="text-xl font-bold mb-4">
        Shfletuesi i të Tarifave Doganore të Republikës së Kosovës
      </h1>
      <aside className="mb-4 text-xs sm:text-sm border rounded-lg p-3 bg-amber-50 border-amber-200">
        <div className="flex justify-between items-center">
          <div className="font-semibold mb-1">⚠️ </div>
          <div className="text-[11px] text-gray-600">
            <span className="font-medium">Përditësuar/Last updated:</span>{" "}
            <time title={lastUpdated.toISOString()}>
              {lastUpdated.toLocaleString()}
            </time>
          </div>
        </div>
        <p className="mb-1">
          Ky aplikacion është jo-zyrtar dhe{" "}
          <strong>nuk përfaqëson Doganën e Kosovës</strong>. Të dhënat ngarkohen
          nga burime publike dhe mund të jenë të papërditësuara. Për informata
          zyrtare, referojuni publikimeve zyrtare.
        </p>
      </aside>
      {/* Search + Price */}
      <div className="mb-4 grid grid-cols-1 md:grid-cols-5 gap-3">
        <div>
          <label className="block text-xs text-gray-600 mb-1">
            Prefiksi i Kodit / ID-së
          </label>
          <input
            type="text"
            value={idQuery}
            onChange={(e) => setIdQuery(e.target.value)}
            placeholder="p.sh. 7208 ose 01"
            className="w-full border rounded px-3 py-2 text-sm"
          />
        </div>
        <div className="col-span-3">
          <label className="block text-xs text-gray-600 mb-1">Përshkrimi</label>
          <input
            type="text"
            value={descQuery}
            onChange={(e) => setDescQuery(e.target.value)}
            placeholder='p.sh. "tub çeliku"'
            className="w-full border rounded px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">
            Çmimi i produktit
          </label>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={priceInput}
            onChange={(e) => setPriceInput(e.target.value)}
            placeholder="p.sh. 1000"
            className="w-full border rounded px-3 py-2 text-sm"
          />
        </div>
      </div>
      <div className="w-full md:overflow-x-auto">
        <VirtualizedTreeTable
          columns={columns}
          data={treeData}
          loading={loading}
          autoExpandAll
          idPrefix={idQuery}
          descQuery={descQuery}
          price={price}
        />
      </div>
    </div>
  );
}
export default App;
