/**
 * Utility to classify MLB API event strings into categories
 * that the 3D visualization components can work with.
 *
 * MLB API events include: "Single", "Double", "Triple", "Home Run",
 * "Flyout", "Groundout", "Lineout", "Pop Out", "Grounded Into DP",
 * "Sac Fly", "Sac Bunt", "Force Out", "Fielders Choice",
 * "Field Error", etc.
 */

const HIT_EVENTS = new Set(["Single", "Double", "Triple", "Home Run"]);

const OUT_EVENTS = new Set([
  "Out", "Flyout", "Groundout", "Lineout", "Pop Out",
  "Grounded Into DP", "Sac Fly", "Sac Bunt", "Force Out",
  "Fielders Choice", "Fielders Choice Out",
  "Double Play", "Triple Play",
  "Bunt Groundout", "Bunt Pop Out", "Bunt Lineout",
]);

const REACH_EVENTS = new Set(["Field Error", "Fielders Choice"]);

/**
 * Is this event a hit (batter reaches safely on a base hit)?
 */
export function isHitEvent(event) {
  return HIT_EVENTS.has(event);
}

/**
 * Is this event an out (one or more runners are out)?
 */
export function isOutEvent(event) {
  if (OUT_EVENTS.has(event)) return true;
  // Fallback: anything not a hit and not a reach is probably an out
  if (event && !HIT_EVENTS.has(event) && !REACH_EVENTS.has(event)) return true;
  return false;
}

/**
 * How many bases does the batter reach on this event?
 * Returns 0 for outs, 1-4 for hits/reaches.
 */
export function batterBasesForEvent(event) {
  if (event === "Single" || event === "Field Error" || event === "Fielders Choice") return 1;
  if (event === "Double") return 2;
  if (event === "Triple") return 3;
  if (event === "Home Run") return 4;
  return 0; // outs
}

/**
 * Is this a fly ball type out (caught in the air)?
 * Used to determine if runners tag up vs are forced.
 */
export function isFlyOut(event) {
  return ["Flyout", "Lineout", "Pop Out", "Sac Fly", "Bunt Pop Out", "Bunt Lineout"].includes(event);
}

/**
 * Is this a ground ball type out?
 */
export function isGroundOut(event) {
  return ["Groundout", "Grounded Into DP", "Force Out", "Bunt Groundout",
    "Fielders Choice", "Fielders Choice Out", "Double Play"].includes(event);
}

/**
 * Is this a double play?
 */
export function isDoublePlay(event, description = "") {
  if (["Grounded Into DP", "Double Play"].includes(event)) return true;
  if (description.toLowerCase().includes("double play")) return true;
  return false;
}

/**
 * Is this a sacrifice fly?
 */
export function isSacFly(event, description = "") {
  if (event === "Sac Fly") return true;
  const desc = description.toLowerCase();
  return desc.includes("sac fly") || desc.includes("sacrifice fly");
}

/**
 * Is this a fielder's choice?
 */
export function isFieldersChoice(event) {
  return ["Fielders Choice", "Fielders Choice Out"].includes(event);
}

/**
 * Normalize event to a display label.
 */
export function eventDisplayLabel(event) {
  if (event === "Grounded Into DP") return "Double Play";
  if (event === "Fielders Choice Out") return "Fielder's Choice";
  if (event === "Fielders Choice") return "Fielder's Choice";
  if (event === "Field Error") return "Error";
  if (event === "Sac Fly") return "Sac Fly";
  if (event === "Sac Bunt") return "Sac Bunt";
  if (event === "Pop Out") return "Pop Out";
  if (event === "Bunt Groundout") return "Groundout";
  return event;
}
