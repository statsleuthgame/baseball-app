import { useState } from "react";
import BallInPlay3D from "./BallInPlay3D";

/**
 * Demo page for testing the 3D Ball Flight Viewer.
 * Provides sample hit data presets and controls to tweak parameters.
 */

const SAMPLE_HITS = {
  homeRun: {
    label: "Grand Slam — Bases Loaded",
    data: {
      x: 125.8, y: 40.5,
      exitVelo: 112.4, launchAngle: 28, distance: 425,
      trajectory: "fly_ball", event: "Home Run",
      description: "Aaron Judge hits a grand slam to deep center field",
    },
    runnersOn: { first: true, second: true, third: true },
    teamId: 147, // Yankees
  },
  lineDriveSingle: {
    label: "RBI Single — Runner on Third",
    data: {
      x: 75.2, y: 105.3,
      exitVelo: 101.2, launchAngle: 12, distance: 215,
      trajectory: "line_drive", event: "Single",
      description: "lines a single past the left fielder, run scores",
    },
    runnersOn: { third: true },
    teamId: 137, // Giants
  },
  groundBallOut: {
    label: "Ground Ball to Short — Runner on First",
    data: {
      x: 105.0, y: 162.0,
      exitVelo: 88.5, launchAngle: -8, distance: 90,
      trajectory: "ground_ball", event: "Out",
      description: "grounds out, shortstop to first baseman",
    },
    runnersOn: { first: true },
    teamId: 111, // Red Sox
  },
  deepFlyOut: {
    label: "Sac Fly — Runner on Third Scores",
    data: {
      x: 155.0, y: 62.0,
      exitVelo: 98.7, launchAngle: 32, distance: 380,
      trajectory: "fly_ball", event: "Out",
      description: "flies out to right fielder, runner scores on the sac fly",
    },
    runnersOn: { third: true },
    teamId: 119, // Dodgers
  },
  tripleToGap: {
    label: "Triple Clears the Bases",
    data: {
      x: 155.3, y: 55.8,
      exitVelo: 105.1, launchAngle: 18, distance: 370,
      trajectory: "line_drive", event: "Triple",
      description: "triples to right-center gap, clears the bases",
    },
    runnersOn: { first: true, second: true },
    teamId: 136, // Mariners
  },
  barreledDouble: {
    label: "Double Off the Wall — Runner Scores",
    data: {
      x: 80.5, y: 60.2,
      exitVelo: 108.3, launchAngle: 22, distance: 390,
      trajectory: "fly_ball", event: "Double",
      description: "doubles off the left field wall, runner scores from second",
    },
    runnersOn: { second: true },
    teamId: 121, // Mets
  },
  popup: {
    label: "Popup — Bases Empty",
    data: {
      x: 130.5, y: 155.0,
      exitVelo: 72.1, launchAngle: 55, distance: 120,
      trajectory: "popup", event: "Out",
      description: "pops out to second baseman in shallow right",
    },
    runnersOn: {},
    teamId: 112, // Cubs
  },
  oppoFieldHR: {
    label: "2-Run HR to Right",
    data: {
      x: 195.0, y: 80.5,
      exitVelo: 106.8, launchAngle: 26, distance: 395,
      trajectory: "fly_ball", event: "Home Run",
      description: "homers to right field, two-run shot",
    },
    runnersOn: { second: true },
    teamId: 108, // Angels
  },
  doublePlay: {
    label: "6-4-3 Double Play — Runner on First",
    data: {
      x: 105.0, y: 162.0,
      exitVelo: 91.2, launchAngle: -5, distance: 95,
      trajectory: "ground_ball", event: "Out",
      description: "grounds into double play, shortstop to second baseman to first baseman",
    },
    runnersOn: { first: true },
    teamId: 114, // Guardians
  },
};

const TEAM_OPTIONS = [
  { id: 108, name: "Angels" }, { id: 109, name: "D-backs" },
  { id: 110, name: "Orioles" }, { id: 111, name: "Red Sox" },
  { id: 112, name: "Cubs" }, { id: 113, name: "Reds" },
  { id: 114, name: "Guardians" }, { id: 115, name: "Rockies" },
  { id: 116, name: "Tigers" }, { id: 117, name: "Astros" },
  { id: 118, name: "Royals" }, { id: 119, name: "Dodgers" },
  { id: 120, name: "Nationals" }, { id: 121, name: "Mets" },
  { id: 133, name: "Athletics" }, { id: 134, name: "Pirates" },
  { id: 135, name: "Padres" }, { id: 136, name: "Mariners" },
  { id: 137, name: "Giants" }, { id: 138, name: "Cardinals" },
  { id: 139, name: "Rays" }, { id: 140, name: "Rangers" },
  { id: 141, name: "Blue Jays" }, { id: 142, name: "Twins" },
  { id: 143, name: "Phillies" }, { id: 144, name: "Braves" },
  { id: 145, name: "White Sox" }, { id: 146, name: "Marlins" },
  { id: 147, name: "Yankees" }, { id: 158, name: "Brewers" },
];

export default function BallFlight3DDemo() {
  const [selectedPreset, setSelectedPreset] = useState("homeRun");
  const [teamId, setTeamId] = useState(147);
  const [hitKey, setHitKey] = useState(0); // force re-mount on replay

  // Custom hit parameters
  const [customMode, setCustomMode] = useState(false);
  const [exitVelo, setExitVelo] = useState(105);
  const [launchAngle, setLaunchAngle] = useState(25);
  const [distance, setDistance] = useState(400);
  const [trajectory, setTrajectory] = useState("fly_ball");
  const [event, setEvent] = useState("Home Run");
  const [hitX, setHitX] = useState(125.42);
  const [hitY, setHitY] = useState(50);
  const [customRunners, setCustomRunners] = useState({ first: false, second: false, third: false });

  const currentHit = customMode
    ? {
        x: hitX, y: hitY,
        exitVelo, launchAngle, distance,
        trajectory, event,
      }
    : SAMPLE_HITS[selectedPreset].data;

  const currentTeam = customMode ? teamId : SAMPLE_HITS[selectedPreset].teamId;
  const currentRunners = customMode ? customRunners : (SAMPLE_HITS[selectedPreset].runnersOn || {});

  const handlePresetChange = (key) => {
    setSelectedPreset(key);
    setCustomMode(false);
    setTeamId(SAMPLE_HITS[key].teamId);
    setHitKey((k) => k + 1);
  };

  const handleFireCustom = () => {
    setCustomMode(true);
    setHitKey((k) => k + 1);
  };

  return (
    <div className="bip3d-demo">
      <div className="bip3d-demo-header">
        <h2>3D Ball Flight Viewer</h2>
        <p>Concept prototype — select a hit scenario or build your own</p>
      </div>

      {/* 3D Viewer */}
      <BallInPlay3D
        key={hitKey}
        hitData={currentHit}
        venueTeamId={currentTeam}
        runnersOn={currentRunners}
      />

      {/* Controls panel */}
      <div className="bip3d-demo-controls">
        {/* Preset hits */}
        <div className="bip3d-demo-section">
          <h3>Sample Hits</h3>
          <div className="bip3d-preset-grid">
            {Object.entries(SAMPLE_HITS).map(([key, { label, data, runnersOn }]) => {
              const isHit = ["Single", "Double", "Triple", "Home Run"].includes(data.event);
              const runnerCount = [runnersOn?.first, runnersOn?.second, runnersOn?.third].filter(Boolean).length;
              return (
                <button
                  key={key}
                  className={`bip3d-preset-btn ${selectedPreset === key && !customMode ? "active" : ""}`}
                  onClick={() => handlePresetChange(key)}
                >
                  <span className="bip3d-preset-dot" style={{ background: isHit ? "#22c55e" : "#ef4444" }} />
                  <span className="bip3d-preset-label">{label}</span>
                  <span className="bip3d-preset-stats">
                    {data.exitVelo} mph · {data.distance}ft · {data.launchAngle}°
                    {runnerCount > 0 && ` · ${runnerCount} on`}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Custom controls */}
        <div className="bip3d-demo-section">
          <h3>Custom Hit Builder</h3>
          <div className="bip3d-custom-grid">
            <label>
              Exit Velocity: <strong>{exitVelo} mph</strong>
              <input type="range" min="50" max="120" value={exitVelo} onChange={(e) => setExitVelo(+e.target.value)} />
            </label>
            <label>
              Launch Angle: <strong>{launchAngle}°</strong>
              <input type="range" min="-20" max="70" value={launchAngle} onChange={(e) => setLaunchAngle(+e.target.value)} />
            </label>
            <label>
              Distance: <strong>{distance} ft</strong>
              <input type="range" min="50" max="500" value={distance} onChange={(e) => setDistance(+e.target.value)} />
            </label>
            <label>
              Trajectory:
              <select value={trajectory} onChange={(e) => setTrajectory(e.target.value)}>
                <option value="fly_ball">Fly Ball</option>
                <option value="line_drive">Line Drive</option>
                <option value="ground_ball">Ground Ball</option>
                <option value="popup">Popup</option>
              </select>
            </label>
            <label>
              Result:
              <select value={event} onChange={(e) => setEvent(e.target.value)}>
                <option value="Home Run">Home Run</option>
                <option value="Triple">Triple</option>
                <option value="Double">Double</option>
                <option value="Single">Single</option>
                <option value="Out">Out</option>
              </select>
            </label>
            <label>
              Stadium:
              <select value={teamId} onChange={(e) => setTeamId(+e.target.value)}>
                {TEAM_OPTIONS.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </label>
            <label>
              Runners On Base:
              <div className="bip3d-runner-toggles">
                {["first", "second", "third"].map((base) => (
                  <button
                    key={base}
                    className={`bip3d-runner-toggle ${customRunners[base] ? "active" : ""}`}
                    onClick={() => setCustomRunners((r) => ({ ...r, [base]: !r[base] }))}
                  >
                    {base === "first" ? "1B" : base === "second" ? "2B" : "3B"}
                  </button>
                ))}
              </div>
            </label>
          </div>
          <button className="bip3d-fire-btn" onClick={handleFireCustom}>
            🔥 Launch Ball
          </button>
        </div>
      </div>
    </div>
  );
}
