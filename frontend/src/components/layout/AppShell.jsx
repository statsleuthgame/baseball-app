import { Outlet } from "react-router-dom";
import TopBar from "./TopBar";
import BottomNav from "./BottomNav";

export default function AppShell() {
  return (
    <div className="app-shell">
      <TopBar />
      <main className="app-content">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}
