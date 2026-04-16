import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTeam } from "../../context/TeamContext";
import { fetchStandings } from "../../api/client";
import { teamNickname, getTeamAbbr } from "../../utils/formatters";
import SkeletonLoader from "../common/SkeletonLoader";

// League IDs: 103 = American, 104 = National
const LEAGUE_NAMES = { 103: "American League", 104: "National League" };

const TABS = [
  { id: "division", label: "Division" },
  { id: "league", label: "League" },
  { id: "wildcard", label: "Wild Card" },
  { id: "playoffs", label: "Playoff Picture" },
];

export default function FullStandings() {
  const { team, setTeamId } = useTeam();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("division");

  const { data: divisions, isLoading } = useQuery({
    queryKey: ["standings"],
    queryFn: () => fetchStandings(),
    staleTime: 1000 * 60 * 30,
  });

  if (isLoading) return <SkeletonLoader variant="standings" />;
  if (!divisions?.length) return <div className="full-standings"><p>Standings unavailable.</p></div>;

  const onTeamClick = (teamId) => {
    setTeamId(teamId);
    navigate(`/team/${teamId}`);
  };

  return (
    <div className="full-standings">
      <div className="full-standings-header">
        <button className="full-standings-back" onClick={() => navigate(`/team/${team?.id}`)} aria-label="Back">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
        <h1 className="full-standings-title">Standings</h1>
      </div>

      <div className="full-standings-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={activeTab === t.id}
            className={`full-standings-tab ${activeTab === t.id ? "active" : ""}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="full-standings-body">
        {activeTab === "division" && <DivisionView divisions={divisions} myTeamId={team?.id} onTeamClick={onTeamClick} />}
        {activeTab === "league" && <LeagueView divisions={divisions} myTeamId={team?.id} onTeamClick={onTeamClick} />}
        {activeTab === "wildcard" && <WildCardView divisions={divisions} myTeamId={team?.id} onTeamClick={onTeamClick} />}
        {activeTab === "playoffs" && <PlayoffView divisions={divisions} myTeamId={team?.id} onTeamClick={onTeamClick} />}
      </div>
    </div>
  );
}

/* -------- View: By Division -------- */
function DivisionView({ divisions, myTeamId, onTeamClick }) {
  // Group by league, then list divisions
  const al = divisions.filter((d) => d.leagueId === 103);
  const nl = divisions.filter((d) => d.leagueId === 104);
  return (
    <>
      {[{ label: "American League", divs: al }, { label: "National League", divs: nl }].map((group) => (
        <section key={group.label} className="standings-group">
          <h2 className="standings-group-title">{group.label}</h2>
          {group.divs.map((div) => (
            <StandingsTable
              key={div.divisionId}
              title={div.divisionName}
              teams={div.teams}
              myTeamId={myTeamId}
              onTeamClick={onTeamClick}
              showWCGB
            />
          ))}
        </section>
      ))}
    </>
  );
}

/* -------- View: By League (overall rank) -------- */
function LeagueView({ divisions, myTeamId, onTeamClick }) {
  const buildLeague = (leagueId) => {
    const teams = divisions
      .filter((d) => d.leagueId === leagueId)
      .flatMap((d) => d.teams)
      .sort((a, b) => parseFloat(b.winPct) - parseFloat(a.winPct) || b.wins - a.wins);
    return teams;
  };
  return (
    <>
      <section className="standings-group">
        <h2 className="standings-group-title">American League</h2>
        <StandingsTable teams={buildLeague(103)} myTeamId={myTeamId} onTeamClick={onTeamClick} showWCGB />
      </section>
      <section className="standings-group">
        <h2 className="standings-group-title">National League</h2>
        <StandingsTable teams={buildLeague(104)} myTeamId={myTeamId} onTeamClick={onTeamClick} showWCGB />
      </section>
    </>
  );
}

/* -------- View: Wild Card race -------- */
function WildCardView({ divisions, myTeamId, onTeamClick }) {
  const buildWC = (leagueId) => {
    // Division winners (rank 1 per division) are excluded from WC race
    const leagueDivs = divisions.filter((d) => d.leagueId === leagueId);
    const divisionWinnerIds = new Set(
      leagueDivs.map((d) => {
        const sorted = [...d.teams].sort((a, b) => parseFloat(b.winPct) - parseFloat(a.winPct) || b.wins - a.wins);
        return sorted[0]?.id;
      })
    );
    const wcTeams = leagueDivs
      .flatMap((d) => d.teams)
      .filter((t) => !divisionWinnerIds.has(t.id))
      .sort((a, b) => parseFloat(b.winPct) - parseFloat(a.winPct) || b.wins - a.wins);
    return wcTeams;
  };

  const renderLeague = (name, leagueId) => {
    const teams = buildWC(leagueId);
    const inWC = teams.slice(0, 3);
    const hunt = teams.slice(3, 8);
    return (
      <section key={leagueId} className="standings-group">
        <h2 className="standings-group-title">{name}</h2>
        {inWC.length > 0 && (
          <StandingsTable
            title="In the Wild Card"
            teams={inWC}
            myTeamId={myTeamId}
            onTeamClick={onTeamClick}
            seedStart={4}
            showWCGB
            inPlayoffs
          />
        )}
        {hunt.length > 0 && (
          <StandingsTable
            title="In the Hunt"
            teams={hunt}
            myTeamId={myTeamId}
            onTeamClick={onTeamClick}
            showWCGB
          />
        )}
      </section>
    );
  };

  return (
    <>
      {renderLeague("American League", 103)}
      {renderLeague("National League", 104)}
    </>
  );
}

/* -------- View: Playoff Picture (seeds 1-6) -------- */
function PlayoffView({ divisions, myTeamId, onTeamClick }) {
  const buildSeeds = (leagueId) => {
    const leagueDivs = divisions.filter((d) => d.leagueId === leagueId);
    // Division winners by best winPct in their division
    const divWinners = leagueDivs
      .map((d) => {
        const sorted = [...d.teams].sort((a, b) => parseFloat(b.winPct) - parseFloat(a.winPct) || b.wins - a.wins);
        return sorted[0];
      })
      .filter(Boolean)
      .sort((a, b) => parseFloat(b.winPct) - parseFloat(a.winPct) || b.wins - a.wins);
    const divWinnerIds = new Set(divWinners.map((t) => t.id));
    const wildCards = leagueDivs
      .flatMap((d) => d.teams)
      .filter((t) => !divWinnerIds.has(t.id))
      .sort((a, b) => parseFloat(b.winPct) - parseFloat(a.winPct) || b.wins - a.wins)
      .slice(0, 3);
    return { divWinners, wildCards };
  };

  const renderLeague = (name, leagueId) => {
    const { divWinners, wildCards } = buildSeeds(leagueId);
    return (
      <section key={leagueId} className="standings-group">
        <h2 className="standings-group-title">{name}</h2>
        <StandingsTable
          title="Division Winners (Seeds 1-3)"
          teams={divWinners}
          myTeamId={myTeamId}
          onTeamClick={onTeamClick}
          seedStart={1}
          showWCGB
          inPlayoffs
        />
        <StandingsTable
          title="Wild Cards (Seeds 4-6)"
          teams={wildCards}
          myTeamId={myTeamId}
          onTeamClick={onTeamClick}
          seedStart={4}
          showWCGB
          inPlayoffs
        />
      </section>
    );
  };

  return (
    <>
      {renderLeague("American League", 103)}
      {renderLeague("National League", 104)}
    </>
  );
}

/* -------- Shared table renderer -------- */
function StandingsTable({ title, teams, myTeamId, onTeamClick, seedStart, showWCGB, inPlayoffs }) {
  if (!teams?.length) return null;
  return (
    <div className="fs-table-wrap">
      {title && <h3 className="fs-table-title">{title}</h3>}
      <div className="fs-table-scroll">
        <table className="fs-table">
          <thead>
            <tr>
              {seedStart != null && <th scope="col" className="fs-col-seed">#</th>}
              <th scope="col" className="fs-col-team">Team</th>
              <th scope="col"><abbr title="Wins">W</abbr></th>
              <th scope="col"><abbr title="Losses">L</abbr></th>
              <th scope="col"><abbr title="Win Percentage">PCT</abbr></th>
              <th scope="col"><abbr title="Games Back">GB</abbr></th>
              {showWCGB && <th scope="col"><abbr title="Wild Card Games Back">WCGB</abbr></th>}
              <th scope="col"><abbr title="Last 10 Games">L10</abbr></th>
              <th scope="col"><abbr title="Streak">STRK</abbr></th>
              <th scope="col"><abbr title="Home Record">HOME</abbr></th>
              <th scope="col"><abbr title="Away Record">AWAY</abbr></th>
              <th scope="col"><abbr title="Runs Scored">RS</abbr></th>
              <th scope="col"><abbr title="Runs Allowed">RA</abbr></th>
              <th scope="col"><abbr title="Run Differential">DIFF</abbr></th>
            </tr>
          </thead>
          <tbody>
            {teams.map((t, i) => (
              <tr
                key={t.id}
                className={`${t.id === myTeamId ? "my-team" : ""} ${inPlayoffs ? "in-playoffs" : ""}`}
                aria-current={t.id === myTeamId ? "true" : undefined}
                onClick={() => onTeamClick(t.id)}
                style={{ cursor: "pointer" }}
              >
                {seedStart != null && <td className="fs-col-seed">{seedStart + i}</td>}
                <td className="fs-col-team">
                  <img src={t.logoUrl} alt="" className="fs-logo" />
                  <span className="fs-team-name">{teamNickname(t.abbreviation || getTeamAbbr(t.id))}</span>
                  {t.clinchIndicator && <span className="fs-clinch" title={clinchTooltip(t.clinchIndicator)}>{t.clinchIndicator}</span>}
                </td>
                <td>{t.wins}</td>
                <td>{t.losses}</td>
                <td>{t.winPct}</td>
                <td>{t.gamesBack}</td>
                {showWCGB && <td>{t.wildCardGamesBack}</td>}
                <td>{t.lastTenRecord}</td>
                <td className={streakClass(t.streakCode)}>{t.streakCode || "-"}</td>
                <td>{t.homeRecord}</td>
                <td>{t.awayRecord}</td>
                <td>{t.runsScored}</td>
                <td>{t.runsAllowed}</td>
                <td className={t.runDifferential > 0 ? "diff-pos" : t.runDifferential < 0 ? "diff-neg" : ""}>
                  {t.runDifferential > 0 ? `+${t.runDifferential}` : t.runDifferential}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function streakClass(code) {
  if (!code) return "";
  if (code.startsWith("W")) return "streak-win";
  if (code.startsWith("L")) return "streak-loss";
  return "";
}

function clinchTooltip(code) {
  const map = {
    z: "Clinched home-field advantage",
    y: "Clinched division",
    x: "Clinched postseason berth",
    w: "Clinched wild card",
    e: "Eliminated from postseason contention",
    "*": "Clinched wild card",
  };
  return map[code] || code;
}
