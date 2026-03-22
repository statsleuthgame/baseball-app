import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:8000",
  timeout: 30000,
});

export const fetchTeamInfo = (teamId) => api.get(`/api/team/${teamId}/info`).then((r) => r.data);
export const fetchRoster = (teamId) => api.get(`/api/team/${teamId}/roster`).then((r) => r.data);
export const fetchSchedule = (teamId, season) =>
  api.get(`/api/team/${teamId}/schedule`, { params: { season } }).then((r) => r.data);
export const fetchTodayGame = (teamId) => api.get(`/api/team/${teamId}/today`).then((r) => r.data);
export const fetchStandings = (season) =>
  api.get("/api/standings", { params: { season } }).then((r) => r.data);
export const fetchPlayoffOdds = () => api.get("/api/standings/playoffs").then((r) => r.data);
export const fetchPlayerDetail = (playerId) =>
  api.get(`/api/player/${playerId}/detail`).then((r) => r.data);
export const fetchPlayerStats = (playerId, season, group) =>
  api.get(`/api/player/${playerId}/stats`, { params: { season, group } }).then((r) => r.data);

export const fetchPlayerAdvanced = (playerId, season) =>
  api.get(`/api/player/${playerId}/advanced`, { params: { season } }).then((r) => r.data);
export const fetchPlayerArsenal = (playerId, season) =>
  api.get(`/api/player/${playerId}/arsenal`, { params: { season } }).then((r) => r.data);
export const fetchPlayerDominance = (playerId, season) =>
  api.get(`/api/player/${playerId}/dominance`, { params: { season } }).then((r) => r.data);

export const fetchHotPlayers = (teamId) =>
  api.get(`/api/hotplayers/${teamId}`).then((r) => r.data);
export const fetchSprayChart = (playerId, homeTeam, season) =>
  api.get(`/api/spraychart/${playerId}`, { params: { homeTeam, season } }).then((r) => r.data);
export const fetchVenues = () => api.get("/api/spraychart/venues").then((r) => r.data);

export const fetchBvP = (batterId, pitcherId) =>
  api.get("/api/matchup/bvp", { params: { batterId, pitcherId } }).then((r) => r.data);
export const fetchPitchTypeMatchup = (batterId, pitcherId) =>
  api.get("/api/matchup/pitch-type", { params: { batterId, pitcherId } }).then((r) => r.data);
export const fetchParkHistory = (teamId, venueId) =>
  api.get("/api/matchup/park-history", { params: { teamId, venueId } }).then((r) => r.data);
export const fetchPriorMatchups = (team1, team2, season) =>
  api.get("/api/matchup/prior", { params: { team1, team2, season } }).then((r) => r.data);

export default api;
