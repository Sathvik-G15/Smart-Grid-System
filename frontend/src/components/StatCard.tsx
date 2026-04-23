interface Props {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  trend?: { value: number; label: string };
  accent?: 'green' | 'blue' | 'amber' | 'rose';
  loading?: boolean;
}

const accentMap = {
  green: 'from-primary-500/20 to-primary-600/10 border-primary-500/20 text-primary-400',
  blue:  'from-accent-500/20  to-accent-600/10  border-accent-500/20  text-accent-400',
  amber: 'from-amber-500/20   to-amber-600/10   border-amber-500/20   text-amber-400',
  rose:  'from-rose-500/20    to-rose-600/10    border-rose-500/20    text-rose-400',
};

export default function StatCard({ title, value, subtitle, icon, trend, accent = 'green', loading }: Props) {
  const ac = accentMap[accent];
  return (
    <div className="stat-card animate-fade-in">
      <div className="flex items-start justify-between">
        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${ac} border flex items-center justify-center`}>
          {icon}
        </div>
        {trend && (
          <span className={`badge ${trend.value >= 0 ? 'bg-primary-500/10 text-primary-400' : 'bg-rose-500/10 text-rose-400'}`}>
            {trend.value >= 0 ? '▲' : '▼'} {Math.abs(trend.value)}%
          </span>
        )}
      </div>
      {loading ? (
        <div className="mt-3 space-y-2">
          <div className="h-7 bg-white/5 rounded-lg animate-pulse" />
          <div className="h-4 w-2/3 bg-white/5 rounded animate-pulse" />
        </div>
      ) : (
        <>
          <div className="mt-3">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{title}</p>
            <p className="text-2xl font-bold text-white mt-0.5">{value}</p>
          </div>
          {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
        </>
      )}
    </div>
  );
}
