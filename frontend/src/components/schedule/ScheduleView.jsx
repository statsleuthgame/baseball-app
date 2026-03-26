import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTeam } from "../../context/TeamContext";
import { fetchSchedule } from "../../api/client";
import { formatGameDate, formatGameTime } from "../../utils/formatters";
import LoadingSpinner from "../common/LoadingSpinner";
import ErrorMessage from "../common/ErrorMessage";

const MONTHS = ["Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct"];

export default function ScheduleView() {
  const { teamId } = useTeam();
  const navigate = useNavigate();
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().getMonth());

  const { data: games, isLoading, error, refetch } = useQuery({
    queryKey: ["schedule", teamId],
    queryFn: () => fetchSchedule(teamId),
    enabled: !!teamId,
    staleTime: 1000 * 60 * 30,
  });

  if (isLoading) return <LoadingSpinner text="Loading schedule..." />;
  if (error) return <ErrorMessage message="Failed to load schedule." onRetry={refetch} />;
  if (!games?.length) return <p className="no-data">No schedule available.</p>;

  const filtered = selectedMonth != null
    ? games.filter((g) => new Date(g.gameDate).getMonth() === selectedMonth)
    : games;

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
            <div key={game.gamePk} className={`schedule-row ${won ? "win" : lost ? "loss" : ""}`} onClick={() => navigate(`/team/${teamId}/matchup/${game.gamePk}`)} style={{ cursor: "pointer" }}>
              <div className="schedule-date">{formatGameDate(game.gameDate)}</div>
              <div className="schedule-opponent">
                <img src={opponent.logoUrl} alt={opponent.abbreviation} className="schedule-logo" />
                <span>{isHome ? "vs" : "@"} {opponent.abbreviation}</span>
              </div>
              <div className="schedule-result">
                {isFinal ? (
                  <span className={won ? "win-text" : "loss-text"}>
                    {won ? "W" : "L"} {us.score}-{opponent.score}
                  </span>
                ) : (
                  <span className="schedule-time">{formatGameTime(game.gameDate)}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
