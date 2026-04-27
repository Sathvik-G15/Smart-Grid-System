import { useMemo, useState } from 'react';
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { api } from '../services/api';
import { useFetch } from '../hooks/useFetch';
import StatCard from '../components/StatCard';
import { Zap, TrendingUp, Thermometer, Wind, Activity, CalendarDays } from 'lucide-react';
import type { DailyRecord } from '../types/api';
import { format, subDays } from 'date-fns';


const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload?.length) {
    return (
      <div className="bg-dark-850 border border-white/10 rounded-xl p-3 shadow-2xl text-xs">
        <p className="text-gray-400 mb-2 font-medium">{label}</p>
        {payload.map((p: any) => (
          <p key={p.name} style={{ color: p.color }} className="flex justify-between gap-4">
            <span>{p.name}</span>
            <span className="font-bold">{typeof p.value === 'number' ? p.value.toFixed(1) : p.value}</span>
          </p>
        ))}
      </div>
    );
  }
  return null;
};

export default function Dashboard() {
  const { data: locations } = useFetch(() => api.locations(), []);
  const [selLoc, setSelLoc] = useState<string>('');

  const locationName = useMemo(() => {
    if (!selLoc || !locations) return undefined;
    return locations.find(l => l.location_id === selLoc)?.location;
  }, [selLoc, locations]);



  const { data: daily,   loading: dl } = useFetch(() => api.daily({ location: locationName, limit: 365 }), [locationName]);
  const { data: monthly, loading: ml } = useFetch(() => api.monthly({ location: locationName }), [locationName]);
  const { data: stats }                  = useFetch(() => api.stats(), []);
  const { data: forecast             } = useFetch(() => api.forecast(selLoc || 'gcpvj4cmfb0f', 7), [selLoc]);

  const latest: DailyRecord | null = daily?.[daily.length - 1] ?? null;

  const chartDaily = useMemo(() => {
    if (!daily) return [];
    return daily.filter((_, i) => i % 7 === 0).map(d => ({
      date:  d.date?.slice(5),
      Peak:  Math.round(d.peak_demand),
      Avg:   Math.round(d.avg_demand),
      Temp:  Math.round(d.avg_temp ?? 0),
    }));
  }, [daily]);

  const chartMonthly = useMemo(() => {
    if (!monthly) return [];
    return monthly.map(m => ({
      label:  `${format(new Date(m.year, m.month - 1), 'MMM yy')}`,
      Demand: Math.round(m.avg_demand),
      Temp:   Math.round(m.avg_temp ?? 0),
    }));
  }, [monthly]);

  const uniqueLocations = useMemo(() => {
    const seen = new Set<string>();
    return (locations ?? []).filter(l => {
      if (seen.has(l.location)) return false;
      seen.add(l.location);
      return true;
    });
  }, [locations]);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="section-title">
            Smart Grid <span className="glow-text">Dashboard</span>
          </h1>
          <p className="section-subtitle">
            Multi-location AI demand forecasting · 14 global grid sites
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={selLoc}
            onChange={e => setSelLoc(e.target.value)}
            className="input-field text-sm py-2 pr-8"
          >
            <option value="">All Locations</option>
            {uniqueLocations.map(l => (
              <option key={l.location_id} value={l.location_id}>{l.location}</option>
            ))}
          </select>
          <span className="w-2 h-2 rounded-full bg-primary-400 animate-pulse-slow" />
          <span className="text-xs text-primary-400 font-medium">Live</span>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          title="Peak Demand"
          value={latest ? `${latest.peak_demand.toFixed(0)} kWh` : '—'}
          subtitle="Daily peak reading"
          icon={<Zap size={18} className="text-primary-400" />}
          accent="green" loading={dl}
        />
        <StatCard
          title="Avg Demand"
          value={latest ? `${latest.avg_demand.toFixed(0)} kWh` : '—'}
          subtitle="Daily average"
          icon={<Activity size={18} className="text-accent-400" />}
          accent="blue" loading={dl}
        />
        <StatCard
          title="Avg Temperature"
          value={latest?.avg_temp != null ? `${latest.avg_temp.toFixed(1)} °C` : '—'}
          subtitle="Latest day average"
          icon={<Thermometer size={18} className="text-amber-400" />}
          accent="amber" loading={dl}
        />
        <StatCard
          title="Wind Speed"
          value={latest?.avg_wind != null ? `${latest.avg_wind.toFixed(1)} km/h` : '—'}
          subtitle="Latest day average"
          icon={<Wind size={18} className="text-rose-400" />}
          accent="rose" loading={dl}
        />
      </div>

      {/* Model Performance banner */}
      {stats && (
        <div className="card border-primary-500/20 bg-gradient-to-r from-primary-600/10 to-transparent">
          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-2">
              <TrendingUp size={16} className="text-primary-400" />
              <span className="text-sm text-gray-400 font-medium">XGBoost · {stats.model.n_locations} locations</span>
            </div>
            {[
              { label: 'R² Score', val: stats.performance.test.r2.toFixed(4) },
              { label: 'RMSE',     val: `${stats.performance.test.rmse.toFixed(0)} kWh` },
              { label: 'MAE',      val: `${stats.performance.test.mae.toFixed(0)} kWh` },
              { label: 'MAPE',     val: `${stats.performance.test.mape.toFixed(2)}%` },
            ].map(({ label, val }) => (
              <div key={label} className="flex flex-col">
                <span className="text-xs text-gray-500">{label}</span>
                <span className="text-sm font-bold text-white">{val}</span>
              </div>
            ))}
            <div className="ml-auto">
              <span className="badge bg-primary-500/15 text-primary-400 border border-primary-500/20">
                Test Set · 15% per location
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Demand Trend */}
      <div className="chart-container">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-white">Demand Trend</h2>
            <p className="text-xs text-gray-500 mt-0.5">Peak vs Average demand (weekly samples)</p>
          </div>
        </div>
        {dl ? <div className="h-56 bg-white/5 rounded-xl animate-pulse" /> : (
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={chartDaily} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="gradPeak" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#22a362" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#22a362" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradAvg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#0ea5e9" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 11 }} tickLine={false} interval={3} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} tickLine={false} axisLine={false}
                     tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12, color: '#9ca3af' }} />
              <Area type="monotone" dataKey="Peak" stroke="#22a362" fill="url(#gradPeak)" strokeWidth={2} dot={false} />
              <Area type="monotone" dataKey="Avg"  stroke="#0ea5e9" fill="url(#gradAvg)"  strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Temperature vs Demand */}
        <div className="chart-container">
          <h2 className="text-base font-semibold text-white mb-1">Temperature vs Demand</h2>
          <p className="text-xs text-gray-500 mb-4">Monthly average — weather-demand correlation</p>
          {ml ? <div className="h-48 bg-white/5 rounded-xl animate-pulse" /> : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartMonthly} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fill: '#6b7280', fontSize: 10 }} tickLine={false} interval={2} />
                <YAxis yAxisId="left"  tick={{ fill: '#6b7280', fontSize: 11 }} tickLine={false} axisLine={false}
                       tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: '#6b7280', fontSize: 11 }}
                       tickLine={false} axisLine={false} tickFormatter={v => `${v}°`} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12, color: '#9ca3af' }} />
                <Line yAxisId="left"  type="monotone" dataKey="Demand" stroke="#22a362" strokeWidth={2} dot={false} />
                <Line yAxisId="right" type="monotone" dataKey="Temp"   stroke="#f59e0b" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* 7-day forecast */}
        <div className="chart-container">
          <h2 className="text-base font-semibold text-white mb-1">7-Day Demand Forecast</h2>
          <p className="text-xs text-gray-500 mb-4">AI predicted peak & avg demand</p>
          <div className="space-y-2">
            {!forecast ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-8 bg-white/5 rounded-lg animate-pulse" />
              ))
            ) : forecast.map(day => {
              const allPeaks = forecast.map(d => d.peak_kwh);
              const maxPeak  = Math.max(...allPeaks);
              const pct = (day.peak_kwh / maxPeak) * 100;
              return (
                <div key={day.date} className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5 w-32 shrink-0">
                    <CalendarDays size={13} className="text-gray-500" />
                    <span className="text-xs text-gray-400">
                      {format(new Date(day.date + 'T00:00:00'), 'EEE, MMM d')}
                    </span>
                  </div>
                  <div className="flex-1 bg-dark-900 rounded-full h-2 overflow-hidden">
                    <div
                      className="h-2 rounded-full bg-gradient-to-r from-primary-600 to-accent-500"
                      style={{ width: `${Math.min(100, Math.max(5, pct))}%` }}
                    />
                  </div>
                  <div className="text-right w-24 shrink-0">
                    <span className="text-xs font-bold text-white">{day.peak_kwh.toFixed(0)}</span>
                    <span className="text-xs text-gray-500"> kWh</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
