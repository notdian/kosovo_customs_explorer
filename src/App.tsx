import type { JSX } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";

import "./App.css";
import {
  CustomsDataService,
  type CustomsTreeNode,
} from "@/lib/database";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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

function App(): JSX.Element {
  const [treeData, setTreeData] = useState<CustomsTreeNode[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [idQuery, setIdQuery] = useState<string>("");
  const [descQuery, setDescQuery] = useState<string>("");
  const [priceInput, setPriceInput] = useState<string>("");

  const price = useMemo(() => {
    const normalized = (priceInput || "").toString().replace(",", ".");
    const n = Number(normalized);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [priceInput]);

  const codePrefix = useMemo(() => idQuery.trim(), [idQuery]);

  useEffect(() => {
    (async () => {
      try {
        await CustomsDataService.initializeData({ force: false });
        const all = await CustomsDataService.getAllData();
        setTreeData(CustomsDataService.buildTreeFromList(all));
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(async () => {
      try {
        setLoading(true);
        const idPref = (idQuery ?? "").trim();
        const desc = (descQuery ?? "").trim();
        if (!idPref && !desc) {
          const all = await CustomsDataService.getAllData();
          setTreeData(CustomsDataService.buildTreeFromList(all));
        } else {
          const narrowed = await CustomsDataService.searchByFields(idPref, desc, {
            parentLimit: 200,
            itemLimit: 4000,
          });
          setTreeData(CustomsDataService.buildTreeFromList(narrowed));
        }
      } catch (error) {
        console.error("Search error:", error);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [idQuery, descQuery]);

  const columns = useMemo(
    () =>
      createCustomsColumns({
        codePrefix,
      }),
    [codePrefix]
  );

  const topLevelNodes = useMemo(() => treeData.length, [treeData]);

  const idPrefixInputId = "id-prefix-input";
  const descInputId = "description-input";
  const priceInputId = "price-input";

  return (
    <div className="min-h-screen bg-background">
      <main className="container mx-auto flex min-h-screen flex-col gap-10 px-4 py-8 sm:px-6 lg:py-12">
        <section className="space-y-8">
          <header className="space-y-3">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              Shfletuesi i Tarifave Doganore të Republikës së Kosovës
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
              Kërkoni dhe shfletoni tarifat doganore sipas kodit, përshkrimit ose
              llogaritni detyrimet për një vlerë të caktuar. Rezultatet përditësohen
              në çast ndërsa filtroni.
            </p>
          </header>

          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
            <div className="rounded-2xl border border-border/70 bg-card/70 p-6">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Përditësuar / Last updated
              </p>
              <time className="mt-2 block text-lg font-semibold text-foreground" title={__BUILD_TIME__}>
                {__BUILD_TIME__}
              </time>
              <p className="mt-3 text-xs text-muted-foreground">
                Të dhënat rifreskohen periodikisht nga burimet publike të Doganës së Kosovës.
              </p>
            </div>
            <Alert className="h-full border-amber-200 bg-amber-50 text-amber-900">
              <AlertTitle className="flex items-center gap-2 text-sm font-semibold">
                <AlertTriangle aria-hidden className="h-4 w-4" />
                Informacion i rëndësishëm
              </AlertTitle>
              <AlertDescription className="space-y-2 text-xs text-amber-900 sm:text-sm">
                <p>
                  Ky aplikacion është jo-zyrtar dhe
                  <strong> nuk përfaqëson Doganën e Kosovës</strong>. Të dhënat
                  ngarkohen nga burime publike dhe mund të jenë të papërditësuara.
                  Për informata zyrtare, referojuni publikimeve zyrtare.
                </p>
              </AlertDescription>
            </Alert>
          </div>
        </section>

        <section className="space-y-6">
          <Card>
            <CardHeader className="pb-4">
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
                  Prefiksi i Kodit / ID-së
                </Label>
                <Input
                  id={idPrefixInputId}
                  type="text"
                  value={idQuery}
                  onChange={(event) => setIdQuery(event.currentTarget.value)}
                  placeholder="p.sh. 7208 ose 01"
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
                />
                <p className="text-xs text-muted-foreground">
                  Shkruani një pjesë të përshkrimit (p.sh. "vajra" ose "tub") për të parë nën-kodet përkatëse.
                </p>
              </div>
              {/* <div className="space-y-2">
                <Label htmlFor={priceInputId} className="text-sm text-muted-foreground">
                  Çmimi i produktit
                </Label>
                <Input
                  id={priceInputId}
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={priceInput}
                  onChange={(event) => setPriceInput(event.currentTarget.value)}
                  placeholder="p.sh. 1000"
                />
                <p className="text-xs text-muted-foreground">
                  Opsionale: përdoret për të llogaritur detyrimet përkatëse.
                </p>
              </div> */}
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
                <span className="inline-flex items-center gap-2 rounded-full border border-muted-foreground/20 px-3 py-1.5 text-xs font-medium text-muted-foreground">
                  {loading ? "Duke u ngarkuar ..." : `${topLevelNodes} kategori kryesore`}
                </span>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <VirtualizedTreeTable
                columns={columns}
                data={treeData}
                loading={loading}
                autoExpandAll
              />
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  );
}

export default App;
