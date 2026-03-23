import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";

// iOS PWA fix: window.innerHeight gives the TRUE visible screen height
// including the home indicator area. CSS 100vh/100% does NOT.
function setRealHeight() {
  document.documentElement.style.setProperty("--real-height", `${window.innerHeight}px`);
}
setRealHeight();
window.addEventListener("resize", setRealHeight);
window.addEventListener("orientationchange", () => setTimeout(setRealHeight, 100));

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
