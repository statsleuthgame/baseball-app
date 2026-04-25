import { forwardRef } from "react";
import { Link } from "react-router-dom";

const TappableRow = forwardRef(function TappableRow(
  {
    as,
    to,
    href,
    onClick,
    children,
    className = "",
    ariaLabel,
    ariaPressed,
    ariaExpanded,
    ariaControls,
    ariaCurrent,
    disabled,
    type,
    target,
    rel,
    ...rest
  },
  ref
) {
  const classes = `tappable-row ${className}`.trim();

  if (as === "link" || (to && !as)) {
    return (
      <Link
        ref={ref}
        to={to}
        className={classes}
        onClick={onClick}
        aria-label={ariaLabel}
        aria-current={ariaCurrent}
        {...rest}
      >
        {children}
      </Link>
    );
  }

  if (as === "anchor" || (href && !as)) {
    return (
      <a
        ref={ref}
        href={href}
        className={classes}
        onClick={onClick}
        target={target}
        rel={target === "_blank" ? rel || "noopener noreferrer" : rel}
        aria-label={ariaLabel}
        {...rest}
      >
        {children}
      </a>
    );
  }

  return (
    <button
      ref={ref}
      type={type || "button"}
      className={classes}
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      aria-expanded={ariaExpanded}
      aria-controls={ariaControls}
      disabled={disabled}
      {...rest}
    >
      {children}
    </button>
  );
});

export default TappableRow;
