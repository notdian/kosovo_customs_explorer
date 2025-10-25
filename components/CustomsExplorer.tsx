'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { VirtualizedTreeTable } from "@/components/VirtualizedTreeTable";
import { createCustomsColumns } from "@/components/customs-table/columns";
import {
  CustomsDataService,
  type CustomsTreeNode,
  type InitializationProgress,
} from "@/lib/database";

/** Simple debounce without external deps */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export function CustomsExplorer() {
  const [treeData, setTreeData] = useState<CustomsTreeNode[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [idQuery, setIdQuery] = useState<string>("");
  const [descQuery, setDescQuery] = useState<string>("");
  const [indexingState, setIndexingState] =
    useState<InitializationProgress | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [isPending, startTransition] = useTransition();
  const mountedRef = useRef(true);

  const debouncedId = useDebouncedValue(idQuery.trim(), 250);
  const normalizedDescQuery = descQuery.trim();
  const debouncedDesc = useDebouncedValue(
    normalizedDescQuery.length >= 3 ? normalizedDescQuery : "",
    250,
  );
  const codePrefix = debouncedId;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Initial load + DB/index bootstrap
  useEffect(() => {
    setLoading(true);
    (async () => {
      try {
        await CustomsDataService.initializeData({
          force: false,
          onProgress: (progress) => {
            if (progress.phase === "done" || progress.phase === "cached") {
              setIndexingState(null);
              return;
            }
            setIndexingState(progress);
          },
        });

        const all = await CustomsDataService.getAllData();
        if (!mountedRef.current) return;
        startTransition(() => {
          setTreeData(CustomsDataService.buildTreeFromList(all));
          setInitialized(true);
        });
      } catch (error) {
        console.error("Failed to initialize customs data:", error);
        if (!mountedRef.current) return;
        setIndexingState((current) =>
          current && current.phase === "error" ? current : {
            phase: "error",
            loaded: 0,
            total: 0,
            message: "Indeksimi dështoi. Kontrolloni konsolën për detaje.",
          }
        );
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    })();
  }, [startTransition]);

  // Querying (debounced)
  useEffect(() => {
    if (!initialized) return;
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);

        const idPref = debouncedId;
        const desc = debouncedDesc;

        const nextList =
          !idPref && !desc
            ? await CustomsDataService.getAllData()
            : await CustomsDataService.searchByFields(idPref, desc);

        if (cancelled || !mountedRef.current) return;
        startTransition(() => {
          setTreeData(CustomsDataService.buildTreeFromList(nextList));
        });
      } catch (error) {
        console.error("Search error:", error);
      } finally {
        if (!cancelled && mountedRef.current) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [debouncedId, debouncedDesc, initialized, startTransition]);

  const columns = useMemo(
    () =>
      createCustomsColumns({
        codePrefix,
      }),
    [codePrefix],
  );

  const topLevelNodes = treeData.length;

  const idPrefixInputId = "id-prefix-input";
  const descInputId = "description-input";

  const progressPercent =
    indexingState && indexingState.total > 0
      ? Math.min(
        100,
        Math.round((indexingState.loaded / indexingState.total) * 100),
      )
      : null;

  const statusText = indexingState
    ? indexingState.message
    : loading || isPending
      ? "Duke u ngarkuar ..."
      : `${topLevelNodes} kategori kryesore`;

  return (
    <section className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold sm:text-xl">
            Filtro të dhënat
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            Plotësoni njërin ose disa prej fushave për të kufizuar rezultatet.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor={idPrefixInputId} className="text-sm text-muted-foreground">
              Prefiksi i Kodit
            </Label>
            <Input
              id={idPrefixInputId}
              type="text"
              value={idQuery}
              onChange={(event) => setIdQuery(event.currentTarget.value)}
              placeholder="p.sh. 7208 ose 01"
              autoComplete="off"
              inputMode="numeric"
            />
          </div>
          <div className="md:col-span-3 space-y-2">
            <Label htmlFor={descInputId} className="text-sm text-muted-foreground">
              Përshkrimi
            </Label>
            <Input
              id={descInputId}
              type="text"
              value={descQuery}
              onChange={(event) => setDescQuery(event.currentTarget.value)}
              placeholder='p.sh. "tub çeliku"'
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Shkruani të paktën 3 shkronja nga përshkrimi (p.sh. &quot;vajra&quot; ose &quot;tub&quot;) për të parë nën-kodet përkatëse.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden gap-0 pb-0">
        <CardHeader className="border-b pb-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1">
              <CardTitle className="text-lg font-semibold sm:text-xl">
                Rezultatet
              </CardTitle>
              <CardDescription>
                Klikoni ikonën për të zgjeruar hierarkinë e kodeve dhe shikoni detyrimet e llogaritura në kohë reale.
              </CardDescription>
            </div>
            <span
              className="inline-flex items-center gap-2 rounded-full border border-muted-foreground/20 px-3 py-1.5 text-xs font-medium text-muted-foreground"
              aria-live="polite"
              aria-atomic="true"
            >
              {statusText}
            </span>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {indexingState ? (
            <div className="space-y-2 border-b px-4 py-3 text-xs text-muted-foreground sm:text-sm">
              <div className="flex items-center justify-between gap-4">
                <span>{indexingState.message}</span>
                {progressPercent !== null ? (
                  <span className="font-medium text-foreground">
                    {progressPercent}%
                  </span>
                ) : null}
              </div>
              {progressPercent !== null ? (
                <div className="h-1.5 rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-200 ease-out"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          <VirtualizedTreeTable
            columns={columns}
            data={treeData}
            loading={loading || isPending}
            autoExpandAll
          />
        </CardContent>
      </Card>
    </section>
  );
}
