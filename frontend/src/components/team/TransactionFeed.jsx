import { useQuery } from "@tanstack/react-query";
import { useTeam } from "../../context/TeamContext";
import { fetchTransactions } from "../../api/client";
import { formatGameDate } from "../../utils/formatters";

const TYPE_ICONS = {
  SC: "IL", DFA: "DFA", ASG: "ASG", OPT: "OPT",
  REL: "REL", SFA: "FA", TR: "TRD", RET: "RET",
};

export default function TransactionFeed() {
  const { teamId } = useTeam();

  const { data: transactions } = useQuery({
    queryKey: ["transactions", teamId],
    queryFn: () => fetchTransactions(teamId),
    enabled: !!teamId,
    staleTime: 1000 * 60 * 60,
  });

  if (!transactions?.length) return null;

  return (
    <div className="transactions-card">
      <h3 className="section-title">Recent Transactions</h3>
      <div className="transactions-list">
        {transactions.map((t) => (
          <div key={t.id} className="transaction-row">
            <span className="transaction-badge">{TYPE_ICONS[t.type] || t.type}</span>
            <div className="transaction-info">
              <span className="transaction-desc">{t.description}</span>
              <span className="transaction-date">{formatGameDate(t.date)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
