import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardHeader } from "@/components/ui/card";
import { CustomsExplorer } from "@/components/CustomsExplorer";
import { AlertTriangle, Github } from "lucide-react";

const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME ?? "—";

export default function Home() {
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

          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] items-start">
            <Card className="rounded-2xl border border-border/70 bg-card/70 px-6">
              <CardHeader className=" px-0">
                <div className="flex justify-between items-start">
                  <p className="text-md font-bold uppercase tracking-wide">
                    Përditësuar / Last updated
                  </p>
                  <time title={buildTime} dateTime={buildTime}>
                    {buildTime}
                  </time>
                </div>
                <p className="text-xs text-muted-foreground">
                  Të dhënat rifreskohen periodikisht nga burimet publike të Doganës së Kosovës.
                </p>
              </CardHeader>
            </Card>

            <Alert className="border-amber-200 bg-amber-50 text-amber-900">
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

        <CustomsExplorer />

        <footer className="mt-auto border-t border-border/60 pt-6 text-xs text-muted-foreground sm:text-sm">
          <a
            className="inline-flex items-center gap-2 font-medium text-foreground transition hover:text-primary"
            href="https://github.com/notdian/kosovo_customs_explorer"
            rel="noreferrer"
            target="_blank"
          >
            <Github aria-hidden className="h-4 w-4" />
            Shih kodin burimor në GitHub
          </a>
        </footer>
      </main>
    </div >
  );
}
