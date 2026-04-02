import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTeam } from "../../context/TeamContext";
import { fetchSchedule, fetchLiveSchedule } from "../../api/client";
import { formatGameDate, formatGameTime } from "../../utils/formatters";
import LoadingSpinner from "../common/LoadingSpinner";
import ErrorMessage from "../common/ErrorMessage";

const MONTHS = ["Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct"];

export default function ScheduleView() {
  const { teamId } = useTeam();
  const navigate = useNavigate();
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().getMonth());

  const { data: staticGames, isLoading, error, refetch } = useQuery({
    queryKey: ["schedule", teamId],
    queryFn: () => fetchSchedule(teamId),
    enabled: !!teamId,
    staleTime: 1000 * 60 * 30,
  });

  // Supplement static data with live scores from MLB API
  const { data: liveScores } = useQuery({
    queryKey: ["liveSchedule", teamId],
    queryFn: () => fetchLiveSchedule(teamId),
    enabled: !!teamId,
    staleTime: 1000 * 60 * 10,
  });

  // Merge live scores into static schedule
  const games = useMemo(() => {
    if (!staticGames) return null;
    if (!liveScores) return staticGames;
    const liveByPk = {};
    for (const g of liveScores) liveByPk[g.gamePk] = g;
    return staticGames.map((g) => {
      const live = liveByPk[g.gamePk];
      if (live && (live.status === "Final" || live.status === "Game Over")) {
        return { ...g, status: live.status, away: { ...g.away, score: live.awayScore, isWinner: live.awayScore > live.homeScore }, home: { ...g.home, score: live.homeScore, isWinner: live.homeScore > live.awayScore } };
      }
      return g;
    });
  }, [staticGames, liveScores]);

  // Compute rolling record for each game (cumulative W-L up to that point)
  const gamesWithRecord = useMemo(() => {
    if (!games) return [];
    let wins = 0, losses = 0;
    return games.map((g) => {
      const isHome = g.home.id === teamId;
      const us = isHome ? g.home : g.away;
      const isFinal = g.status === "Final";
      if (isFinal && us.isWinner) wins++;
      else if (isFinal && !us.isWinner) losses++;
      return { ...g, record: isFinal ? `${wins}-${losses}` : null };
    });
  }, [games, teamId]);

  const filtered = selectedMonth != null
    ? gamesWithRecord.filter((g) => new Date(g.gameDate).getMonth() === selectedMonth)
    : gamesWithRecord;

  if (isLoading) return <LoadingSpinner text="Loading schedule..." />;
  if (error) return <ErrorMessage message="Failed to load schedule." onRetry={refetch} />;
  if (!games?.length) return <p className="no-data">No schedule available.</p>;

  return (
    <div className="schedule-view">
      <div className="month-filter">
        <button
          className={`month-pill ${selectedMonth == null ? "active" : ""}`}
          onClick={() => setSelectedMonth(null)}
        >
          All
        </button>
        {MONTHS.map((m, i) => {
          const monthIdx = i + 2; // Mar=2, Apr=3...
          return (
            <button
              key={m}
              className={`month-pill ${selectedMonth === monthIdx ? "active" : ""}`}
              onClick={() => setSelectedMonth(monthIdx)}
            >
              {m}
            </button>
          );
        })}
      </div>

      <div className="schedule-list">
        {filtered.map((game) => {
          const isHome = game.home.id === teamId;
          const opponent = isHome ? game.away : game.home;
          const us = isHome ? game.home : game.away;
          const isFinal = game.status === "Final";
          const won = isFinal && us.isWinner;
          const lost = isFinal && !us.isWinner;

          return (
            <div key={game.gamePk} className={`schedule-row ${won ? "win" : lost ? "loss" : ""}`} onClick={() => navigate(`/team/${teamId}/${isFinal ? "live" : "matchup"}/${game.gamePk}`)} style={{ cursor: "pointer" }}>
              <div className="schedule-date">{formatGameDate(game.gameDate)}</div>
              <div className="schedule-opponent">
                <img src={opponent.logoUrl} alt={opponent.abbreviation} className="schedule-logo" />
                <span>{isHome ? "vs" : "@"} {opponent.abbreviation}</span>
              </div>
              <div className="schedule-center">
                {isFinal ? (
                  <span className={`schedule-score ${won ? "win-text" : "loss-text"}`}>
                    {won ? "W" : "L"} {us.score}-{opponent.score}
                  </span>
                ) : (
                  <span className="schedule-time">{formatGameTime(game.gameDate)}</span>
                )}
              </div>
              <div className="schedule-right">
                {isFinal && <span className="schedule-record">{game.record}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
