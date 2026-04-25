import { useState, useId } from "react";

export default function CollapsibleSection({
  title,
  children,
  defaultOpen = true,
  className = "",
  headerClassName = "",
  panelClassName = "",
  headingLevel = 3,
  chevron,
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const panelId = `collapsible-${id}`;
  const Heading = `h${headingLevel}`;

  return (
    <div className={`collapsible-section ${className}`.trim()}>
      <button
        type="button"
        className={`collapsible-header ${headerClassName}`.trim()}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        <Heading className="collapsible-title">{title}</Heading>
        <span className="collapsible-chevron" aria-hidden="true">
          {chevron ?? (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                transform: open ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 0.2s",
              }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          )}
        </span>
      </button>
      <div
        id={panelId}
        role="region"
        className={panelClassName}
        hidden={!open}
      >
        {children}
      </div>
    </div>
  );
}
