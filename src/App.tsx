import { StudioCanvas } from "./components/StudioCanvas";
import { Toolbar } from "./components/Toolbar";
import { DataTable } from "./components/DataTable/DataTable";
import { Inspector } from "./components/Inspector/Inspector";
import { FlightCheckModal } from "./components/FlightCheck/FlightCheckModal";
import { ImportModal } from "./components/Import/ImportModal";
import { TimelineScrubber } from "./components/Timeline/TimelineScrubber";
import { usePlayback } from "./hooks/usePlayback";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useUiStore } from "./store/uiStore";

export default function App() {
  useKeyboardShortcuts();
  usePlayback();
  const flightCheckOpen = useUiStore((s) => s.flightCheckOpen);
  const importOpen = useUiStore((s) => s.importOpen);

  return (
    <div className="flex h-screen flex-col bg-slate-100 text-slate-900">
      <Toolbar />
      <div className="grid min-h-0 flex-1 grid-cols-[340px_1fr_320px]">
        <aside className="overflow-auto border-r border-slate-200 bg-white">
          <DataTable />
        </aside>
        <main className="flex min-h-0 min-w-0 flex-col">
          <div className="min-h-0 flex-1 p-6">
            <StudioCanvas />
          </div>
          <TimelineScrubber />
        </main>
        <aside className="overflow-auto border-l border-slate-200 bg-white">
          <Inspector />
        </aside>
      </div>
      {flightCheckOpen && <FlightCheckModal />}
      {importOpen && <ImportModal />}
    </div>
  );
}
