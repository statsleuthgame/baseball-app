import { createContext, useContext, useId, useRef, useCallback } from "react";

const TabsContext = createContext(null);

export function Tabs({ value, onChange, ariaLabel, className = "", children }) {
  const baseId = useId();
  const tabRefs = useRef({});

  const focusTab = useCallback((key) => {
    const el = tabRefs.current[key];
    if (el && typeof el.focus === "function") el.focus();
  }, []);

  const register = useCallback((key, el) => {
    if (el) tabRefs.current[key] = el;
    else delete tabRefs.current[key];
  }, []);

  return (
    <TabsContext.Provider
      value={{ value, onChange, baseId, register, focusTab, ariaLabel }}
    >
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabList({ className = "", ariaLabel, children }) {
  const ctx = useContext(TabsContext);
  const label = ariaLabel ?? ctx?.ariaLabel;
  const keys = [];

  const onKeyDown = (e) => {
    if (!ctx) return;
    const children = Array.from(e.currentTarget.querySelectorAll('[role="tab"]'));
    const idx = children.findIndex((c) => c === document.activeElement);
    if (idx < 0) return;
    let nextIdx = null;
    if (e.key === "ArrowRight") nextIdx = (idx + 1) % children.length;
    else if (e.key === "ArrowLeft") nextIdx = (idx - 1 + children.length) % children.length;
    else if (e.key === "Home") nextIdx = 0;
    else if (e.key === "End") nextIdx = children.length - 1;
    if (nextIdx !== null) {
      e.preventDefault();
      const nextEl = children[nextIdx];
      const nextKey = nextEl.getAttribute("data-tab-key");
      if (nextKey && ctx.onChange) ctx.onChange(nextKey);
      nextEl.focus();
    }
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      className={className}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
}

export function Tab({ tabKey, className = "", activeClassName = "", children, ...rest }) {
  const ctx = useContext(TabsContext);
  if (!ctx) return null;
  const { value, onChange, baseId, register } = ctx;
  const selected = value === tabKey;
  const tabId = `${baseId}-tab-${tabKey}`;
  const panelId = `${baseId}-panel-${tabKey}`;

  return (
    <button
      type="button"
      role="tab"
      id={tabId}
      data-tab-key={tabKey}
      ref={(el) => register(tabKey, el)}
      aria-selected={selected}
      aria-controls={panelId}
      tabIndex={selected ? 0 : -1}
      className={`${className}${selected ? ` ${activeClassName}` : ""}`}
      onClick={() => onChange?.(tabKey)}
      {...rest}
    >
      {children}
    </button>
  );
}

export function TabPanel({ tabKey, className = "", children }) {
  const ctx = useContext(TabsContext);
  if (!ctx) return null;
  const { value, baseId } = ctx;
  const selected = value === tabKey;
  const tabId = `${baseId}-tab-${tabKey}`;
  const panelId = `${baseId}-panel-${tabKey}`;
  return (
    <div
      role="tabpanel"
      id={panelId}
      aria-labelledby={tabId}
      hidden={!selected}
      tabIndex={0}
      className={className}
    >
      {selected ? children : null}
    </div>
  );
}
