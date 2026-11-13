import { StudioCanvas } from "./components/StudioCanvas";
import { Toolbar } from "./components/Toolbar";
import { DataTable } from "./components/DataTable/DataTable";
import { Inspector } from "./components/Inspector/Inspector";
import { FlightCheckModal } from "./components/FlightCheck/FlightCheckModal";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useUiStore } from "./store/uiStore";

export default function App() {
  useKeyboardShortcuts();
  const flightCheckOpen = useUiStore((s) => s.flightCheckOpen);

  return (
    <div className="flex h-screen flex-col bg-slate-100 text-slate-900">
      <Toolbar />
      <div className="grid min-h-0 flex-1 grid-cols-[340px_1fr_320px]">
        <aside className="overflow-auto border-r border-slate-200 bg-white">
          <DataTable />
        </aside>
        <main className="min-w-0 p-6">
          <StudioCanvas />
        </main>
        <aside className="overflow-auto border-l border-slate-200 bg-white">
          <Inspector />
        </aside>
      </div>
      {flightCheckOpen && <FlightCheckModal />}
    </div>
  );
}
