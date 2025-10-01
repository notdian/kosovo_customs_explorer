import { useEffect, useRef } from "preact/hooks";
import type { JSX } from "preact";
import type { ColumnDef } from "@tanstack/react-table";
import {
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";

import type { CustomsTreeNode } from "@/lib/database";

type VirtualizedTreeTableProps = {
  columns: ColumnDef<CustomsTreeNode, unknown>[];
  data: CustomsTreeNode[];
  loading: boolean;
  autoExpandAll?: boolean;
  price?: number;
};

const GRID_TEMPLATE =
  "minmax(160px,1fr) minmax(600px,1.6fr) 50px 50px 50px 50px 50px 50px 120px";
const MIN_ROW_HEIGHT = 56;

function computeMinTableWidth(template: string): number {
  const staticColumnsWidth = Array.from(template.matchAll(/(\d+)px/g))
    .map((match) => Number(match[1] ?? 0))
    .reduce((total, width) => total + width, 0);
  return 170 + staticColumnsWidth;
}

const MIN_TABLE_WIDTH = computeMinTableWidth(GRID_TEMPLATE);

export function VirtualizedTreeTable({
  columns,
  data,
  loading,
  autoExpandAll = true,
  price = 0,
}: VirtualizedTreeTableProps): JSX.Element {
  const table = useReactTable<CustomsTreeNode>({
    data,
    columns,
    getRowId: (row) => String(row.id),
    getSubRows: (row) => row.subRows ?? [],
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    meta: { price },
  });

  useEffect(() => {
    if (autoExpandAll) table.toggleAllRowsExpanded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, autoExpandAll]);

  const parentRef = useRef<HTMLDivElement | null>(null);
  const rows = table.getRowModel().rows;

  const rowVirtualizer = useVirtualizer({
    count: loading ? 1 : rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => MIN_ROW_HEIGHT,
    overscan: 12,
    getItemKey: (index) => rows[index]?.id ?? index,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  return (
    <div className="w-full overflow-x-auto">
      <div style={{ minWidth: MIN_TABLE_WIDTH }}>
        <div
          className="sticky top-0 z-10 grid gap-4 border-b bg-muted/60 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          style={{ gridTemplateColumns: GRID_TEMPLATE }}
        >
          {table
            .getHeaderGroups()
            .map((headerGroup) =>
              headerGroup.headers.map((header) => (
                <div key={header.id} className="min-w-0">
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                      header.column.columnDef.header,
                      header.getContext()
                    )}
                </div>
              ))
            )}
        </div>
        <div
          ref={parentRef}
          className="relative"
          style={{
            maxHeight: "calc(100vh - 220px)",
            overflowY: "auto",
            scrollbarGutter: "stable both-edges",
          }}
        >
          <div style={{ height: totalSize, position: "relative" }}>
            {loading ? (
              <div
                className="absolute inset-x-0 top-0 grid gap-4 border-b px-4 py-3 text-sm animate-pulse"
                style={{
                  gridTemplateColumns: GRID_TEMPLATE,
                  height: MIN_ROW_HEIGHT,
                }}
              >
                <div className="col-span-full h-4 w-48 animate-pulse rounded bg-muted" />
              </div>
            ) : (
              virtualItems.map((virtualItem) => {
                const row = rows[virtualItem.index];
                if (!row) return null;
                return (
                  <div
                    key={row.id}
                    data-index={virtualItem.index}
                    ref={rowVirtualizer.measureElement}
                    className="absolute inset-x-0 grid gap-4 border-b px-4 py-3 text-sm transition-colors hover:bg-muted/40"
                    style={{
                      gridTemplateColumns: GRID_TEMPLATE,
                      transform: `translateY(${virtualItem.start}px)`,
                      height: virtualItem.size,
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
  );
}
