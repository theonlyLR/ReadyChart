import { StudioCanvas } from "./components/StudioCanvas";
import { Toolbar } from "./components/Toolbar";
import { DataTable } from "./components/DataTable/DataTable";
import { PanelResizer } from "./components/DataTable/PanelResizer";
import { Inspector } from "./components/Inspector/Inspector";
import { FlightCheckModal } from "./components/FlightCheck/FlightCheckModal";
import { DropOverlay } from "./components/Ingest/DropOverlay";
import { ToastHost } from "./components/Ingest/Toast";
import { useGlobalIngest } from "./hooks/useGlobalIngest";
import { TimelineScrubber } from "./components/Timeline/TimelineScrubber";
import { usePlayback } from "./hooks/usePlayback";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useUiStore } from "./store/uiStore";

export default function App() {
  useKeyboardShortcuts();
  useGlobalIngest();
  usePlayback();
  const flightCheckOpen = useUiStore((s) => s.flightCheckOpen);
  const dataPanelWidth = useUiStore((s) => s.dataPanelWidth);

  return (
    <div className="flex h-screen flex-col bg-slate-100 text-slate-900">
      <Toolbar />
      <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: `${dataPanelWidth}px minmax(0, 1fr) 320px` }}>
        <div className="relative min-h-0 min-w-0">
          <aside className="h-full overflow-auto border-r border-slate-200 bg-white">
            <DataTable />
          </aside>
          <PanelResizer />
        </div>
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
      <DropOverlay />
      <ToastHost />
    </div>
  );
}
