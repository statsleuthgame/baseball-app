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

export default api;
