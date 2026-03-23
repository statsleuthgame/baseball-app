import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";

// Measure the real visible height and set it as a CSS variable.
// Measure multiple times because iOS reports different values during launch.
function setRealHeight() {
  const h = window.innerHeight;
  document.documentElement.style.setProperty("--real-height", `${h}px`);
}

setRealHeight();
requestAnimationFrame(setRealHeight);
setTimeout(setRealHeight, 50);
setTimeout(setRealHeight, 200);
setTimeout(setRealHeight, 500);
window.addEventListener("resize", setRealHeight);

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
