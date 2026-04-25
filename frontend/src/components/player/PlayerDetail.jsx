import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTeam } from "../../context/TeamContext";
import { fetchPlayerStats, fetchPlayerSeasonStats } from "../../api/client";
import ALL_TEAMS from "../../data/teams";
import PlayerPhoto from "../common/PlayerPhoto";
import SkeletonLoader from "../common/SkeletonLoader";
import ErrorMessage from "../common/ErrorMessage";
import BatterStats from "./BatterStats";
import PitcherStats from "./PitcherStats";
import AdvancedBatterStats from "./AdvancedBatterStats";
import AdvancedPitcherStats from "./AdvancedPitcherStats";
import PitchArsenal from "./PitchArsenal";
import DominanceProfile from "./DominanceProfile";
import PlayerGameLog from "./PlayerGameLog";
import ContractCard from "./ContractCard";
import MissedCallsPanel from "../strikezone/MissedCallsPanel";

const currentYear = new Date().getFullYear();
const SEASON_OPTIONS = Array.from({ length: 6 }, (_, i) => currentYear - i);

export default function PlayerDetail() {
  const { playerId } = useParams();
  const { teamId } = useTeam();
  const navigate = useNavigate();
  const [selectedSeason, setSelectedSeason] = useState(currentYear);

  const { data: playerData, isLoading, error } = useQuery({
    queryKey: ["playerInfo", playerId],
    queryFn: () => fetchPlayerStats(playerId),
    enabled: !!playerId,
  });

  // Fetch stats for a different season OR when current season static data is empty
  const isCurrentSeason = selectedSeason === currentYear;
  const staticStatsEmpty = isCurrentSeason && playerData?.stats?.stats && Object.keys(playerData.stats.stats).length === 0;
  const { data: seasonStats } = useQuery({
    queryKey: ["playerSeasonStats", playerId, selectedSeason],
    queryFn: () => fetchPlayerSeasonStats(playerId, selectedSeason, playerData?.stats?.group || "hitting"),
    enabled: !!playerId && (!isCurrentSeason || staticStatsEmpty) && !!playerData,
    staleTime: 1000 * 60 * 10,
  });

  const player = playerData?.detail;
  const isPitcher = player?.primaryPosition === "P";

  // Resolve team info for display
  const playerTeamId = player?.currentTeamId
    || Object.values(ALL_TEAMS).find((t) => t.name === player?.currentTeam)?.id;
  const playerTeam = ALL_TEAMS[playerTeamId];

  // Determine which stats to show based on season selector
  const statsObj = playerData?.stats || {};
  let displayStats, displaySeason;

  if (isCurrentSeason && !staticStatsEmpty) {
    displayStats = statsObj.stats || {};
    displaySeason = currentYear;
  } else {
    // Either a past season, or current season with empty static data — use API
    displayStats = seasonStats || {};
    displaySeason = selectedSeason;
  }

  if (isLoading) return <SkeletonLoader variant="player" />;
  if (error || !player?.id) return <ErrorMessage message="Player not found." />;

  return (
    <div className="player-detail">
      <div className="player-header">
        <PlayerPhoto playerId={player.id} name={player.fullName} size={96} />
        <div className="player-header-info">
          <h1 className="player-name">{player.fullName || "Unknown"}</h1>
          {playerTeam && (
            <button
              type="button"
              className="player-team-row player-team-row-link"
              onClick={() => navigate(`/team/${playerTeamId}`)}
              aria-label={`Go to ${playerTeam.name} team page`}
            >
              <img
                src={`https://www.mlbstatic.com/team-logos/team-cap-on-dark/${playerTeamId}.svg`}
                alt=""
                className="player-team-logo"
              />
              <span className="player-team-name">{playerTeam.name}</span>
            </button>
          )}
          <p className="player-meta">
            #{player.primaryNumber || "—"} · {player.primaryPosition || "—"} ·{" "}
            {player.batSide === "R" ? "R" : player.batSide === "L" ? "L" : "S"}/
            {player.pitchHand === "R" ? "R" : "L"}
          </p>
          <p className="player-bio">
            {player.height || "—"} · {player.weight ? `${player.weight} lbs` : "—"} · {player.age ? `Age ${player.age}` : ""}
          </p>
        </div>
      </div>

      {!isPitcher && playerData?.hasFullData && (
        <div className="player-actions">
          <button
            className="player-action-btn"
            onClick={() => {
              navigate(`/team/${teamId}/spray?player=${playerId}&team=${playerTeamId || teamId}`);
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <circle cx="8" cy="9" r="1.5" fill="currentColor" />
              <circle cx="15" cy="7" r="1.5" fill="currentColor" />
              <circle cx="14" cy="14" r="1.5" fill="currentColor" />
            </svg>
            View Spray Chart
          </button>
        </div>
      )}

      {/* Left column on desktop wide: standard stats, game log, arsenal/dominance
          for pitchers, missed calls. Right column: advanced (statcast) metrics
          and contract. Mobile stacks everything naturally. */}
      <div className="player-col-left">
        {isPitcher ? (
          <PitcherStats stats={displayStats} season={displaySeason} selectedSeason={selectedSeason} onSeasonChange={setSelectedSeason} seasons={SEASON_OPTIONS} />
        ) : (
          <BatterStats stats={displayStats} season={displaySeason} selectedSeason={selectedSeason} onSeasonChange={setSelectedSeason} seasons={SEASON_OPTIONS} />
        )}

        <PlayerGameLog playerId={playerId} isPitcher={isPitcher} />

        {isPitcher && (
          <>
            <PitchArsenal playerId={playerId} />
            <DominanceProfile playerId={playerId} />
          </>
        )}

        <MissedCallsPanel playerId={playerId} />
      </div>

      <div className="player-col-right">
        {isPitcher ? (
          <AdvancedPitcherStats playerId={playerId} />
        ) : (
          <AdvancedBatterStats playerId={playerId} />
        )}

        <ContractCard playerName={player.fullName} teamAbbr={playerTeam?.abbreviation} />
      </div>
    </div>
  );
}
