import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTeam } from "../../context/TeamContext";
import { fetchSchedule } from "../../api/client";
import { formatGameDate, formatGameTime } from "../../utils/formatters";
import LoadingSpinner from "../common/LoadingSpinner";
import ErrorMessage from "../common/ErrorMessage";

const MONTHS = ["Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default function ScheduleView() {
  const { teamId, team } = useTeam();
  const navigate = useNavigate();
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().getMonth());

  // fetchSchedule now goes live to MLB Stats API for the full season
  // (previously we merged a stale per-team static JSON with a last-7-days
  // live call, which left older games frozen at generation time). A
  // single live call keeps every game's status + score + running record
  // current across all 30 teams.
  const { data: games, isLoading, error, refetch } = useQuery({
    queryKey: ["schedule", teamId],
    queryFn: () => fetchSchedule(teamId),
    enabled: !!teamId,
    staleTime: 1000 * 60 * 5,          // 5 min — scores update during games
    refetchInterval: 1000 * 60 * 5,
    refetchIntervalInBackground: false, // pause when tab hidden
  });

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
      <h1 className="sr-only">{team?.name || "Team"} schedule</h1>
      <div className="month-filter" role="group" aria-label="Filter by month">
        <button
          type="button"
          className={`month-pill ${selectedMonth == null ? "active" : ""}`}
          onClick={() => setSelectedMonth(null)}
          aria-pressed={selectedMonth == null}
        >
          All
        </button>
        {MONTHS.map((m, i) => {
          const monthIdx = i + 2; // Mar=2, Apr=3...
          return (
            <button
              key={m}
              type="button"
              className={`month-pill ${selectedMonth === monthIdx ? "active" : ""}`}
              onClick={() => setSelectedMonth(monthIdx)}
              aria-pressed={selectedMonth === monthIdx}
              aria-label={`Show ${MONTH_NAMES[monthIdx]} games`}
            >
              {m}
            </button>
          );
        })}
      </div>

      <ul className="schedule-list" aria-label={selectedMonth == null ? "All games" : `${MONTH_NAMES[selectedMonth]} games`}>
        {filtered.map((game) => {
          const isHome = game.home.id === teamId;
          const opponent = isHome ? game.away : game.home;
          const us = isHome ? game.home : game.away;
          const isFinal = game.status === "Final";
          const won = isFinal && us.isWinner;
          const lost = isFinal && !us.isWinner;
          // Non-Final states that mean "no game today" — we show a status
          // badge instead of a time so users don't think the game is still
          // upcoming. "Postponed" is the common one; MLB also emits these.
          const offStates = ["Postponed", "Cancelled", "Suspended", "Delayed", "Delayed Start"];
          const offState = !isFinal && offStates.includes(game.detailedState)
            ? game.detailedState
            : null;

          const resultText = isFinal
            ? `${won ? "Won" : "Lost"} ${us.score} to ${opponent.score}`
            : offState
            ? offState
            : formatGameTime(game.gameDate);
          const ariaLabel = `${formatGameDate(game.gameDate)}, ${isHome ? "vs" : "at"} ${opponent.abbreviation}. ${resultText}${isFinal ? `, record ${game.record}` : ""}. View ${isFinal ? "game details" : "matchup"}.`;

          return (
            <li key={game.gamePk}>
              <button
                type="button"
                className={`schedule-row ${won ? "win" : lost ? "loss" : ""} ${offState ? "off" : ""}`}
                onClick={() => navigate(`/team/${teamId}/${isFinal ? "live" : "matchup"}/${game.gamePk}`)}
                aria-label={ariaLabel}
              >
                <div className="schedule-date">{formatGameDate(game.gameDate)}</div>
                <div className="schedule-opponent">
                  <img src={opponent.logoUrl} alt="" className="schedule-logo" />
                  <span>{isHome ? "vs" : "@"} {opponent.abbreviation}</span>
                </div>
                <div className="schedule-center">
                  {isFinal ? (
                    <span className={`schedule-score ${won ? "win-text" : "loss-text"}`}>
                      {won ? "W" : "L"} {us.score}-{opponent.score}
                    </span>
                  ) : offState ? (
                    <span className="schedule-status">{offState.toUpperCase()}</span>
                  ) : (
                    <span className="schedule-time">{formatGameTime(game.gameDate)}</span>
                  )}
                </div>
                <div className="schedule-right">
                  {isFinal && <span className="schedule-record">{game.record}</span>}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
