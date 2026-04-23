import { useState, useMemo } from 'react';
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
} from 'recharts';
import { api } from '../services/api';
import { useFetch } from '../hooks/useFetch';
import { BarChart3, TrendingDown, Thermometer } from 'lucide-react';

const SEASON_NAMES: Record<number, string> = { 1: 'Winter', 2: 'Spring', 3: 'Summer', 4: 'Autumn' };
const SEASON_COLORS: Record<number, string> = { 1: '#60a5fa', 2: '#34d399', 3: '#fbbf24', 4: '#f97316' };
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const Tip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
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
};

export default function Analytics() {
  const [season,   setSeason]   = useState<number | null>(null);
  const [selLoc,   setSelLoc]   = useState<string>('');

  const { data: locations } = useFetch(() => api.locations(), []);
  const uniqueLocations = useMemo(() => {
    const seen = new Set<string>();
    return (locations ?? []).filter(l => {
      if (seen.has(l.location)) return false;
      seen.add(l.location); return true;
    });
  }, [locations]);

  const locationName = useMemo(() =>
    locations?.find(l => l.location_id === selLoc)?.location,
    [selLoc, locations]);

  const { data: monthly, loading: ml } = useFetch(
    () => api.monthly({ location: locationName }), [locationName]);
  const { data: hourly,  loading: hl } = useFetch(
    () => api.hourlyProfile({ location: locationName, season: season ?? undefined }), [locationName, season]);

  // Annual demand bar chart
  const yearlyTrend = useMemo(() => {
    if (!monthly) return [];
    const byYear: Record<number, { avg: number; count: number }> = {};
    monthly.forEach(m => {
      if (!byYear[m.year]) byYear[m.year] = { avg: 0, count: 0 };
      byYear[m.year].avg   += m.avg_demand;
      byYear[m.year].count += 1;
    });
    return Object.entries(byYear).map(([year, v]) => ({
      year: Number(year),
      'Avg Demand': Math.round(v.avg / v.count),
    }));
  }, [monthly]);

  // Monthly seasonality
  const monthlySeasonality = useMemo(() => {
    if (!monthly) return [];
    const byMonth: Record<number, { demand: number[]; temp: number[] }> = {};
    monthly.forEach(m => {
      if (!byMonth[m.month]) byMonth[m.month] = { demand: [], temp: [] };
      byMonth[m.month].demand.push(m.avg_demand);
      byMonth[m.month].temp.push(m.avg_temp ?? 0);
    });
    return MONTHS.map((name, i) => ({
      month:        name,
      'Avg Demand': byMonth[i+1] ? Math.round(byMonth[i+1].demand.reduce((a,b)=>a+b,0)/byMonth[i+1].demand.length) : 0,
      'Avg Temp':   byMonth[i+1] ? Math.round(byMonth[i+1].temp.reduce((a,b)=>a+b,0)/byMonth[i+1].temp.length)   : 0,
    }));
  }, [monthly]);

  // Radar: seasonal
  const radarData = useMemo(() => {
    if (!monthly) return [];
    const byMonth: Record<number, number[]> = {};
    monthly.forEach(m => { if (!byMonth[m.month]) byMonth[m.month] = []; byMonth[m.month].push(m.avg_demand); });
    return MONTHS.map((name, i) => ({
      month: name,
      demand: byMonth[i+1] ? Math.round(byMonth[i+1].reduce((a,b)=>a+b,0)/byMonth[i+1].length) : 0,
    }));
  }, [monthly]);

  // Hourly profile
  const hourlySeasons = useMemo(() => {
    if (!hourly) return [];
    const grouped: Record<number, Record<number, number>> = {};
    hourly.forEach(h => {
      if (!grouped[h.hour]) grouped[h.hour] = {};
      grouped[h.hour][h.season] = Math.round(h.avg_demand);
    });
    return Object.entries(grouped).sort((a,b) => Number(a[0])-Number(b[0])).map(([hr, seasons]) => ({
      time: `${String(hr).padStart(2,'0')}:00`,
      ...Object.fromEntries(Object.entries(seasons).map(([s, v]) => [SEASON_NAMES[Number(s)], v])),
    }));
  }, [hourly]);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="section-title">Historical <span className="glow-text">Analytics</span></h1>
          <p className="section-subtitle">Demand trends, seasonal patterns & weather correlation (2011–2017)</p>
        </div>
        <select
          value={selLoc}
          onChange={e => setSelLoc(e.target.value)}
          className="input-field text-sm py-2 pr-8 self-start"
        >
          <option value="">All Locations</option>
          {uniqueLocations.map(l => (
            <option key={l.location_id} value={l.location_id}>{l.location}</option>
          ))}
        </select>
      </div>

      {/* Annual demand */}
      <div className="chart-container">
        <h2 className="text-base font-semibold text-white mb-1 flex items-center gap-2">
          <TrendingDown size={16} className="text-primary-400" /> Annual Average Demand
        </h2>
        <p className="text-xs text-gray-500 mb-4">Year-averaged grid demand in kWh</p>
        {ml ? <div className="h-56 bg-white/5 rounded-xl animate-pulse" /> : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={yearlyTrend} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="year" tick={{ fill: '#6b7280', fontSize: 11 }} tickLine={false} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} tickLine={false} axisLine={false}
                     tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
              <Tooltip content={<Tip />} />
              <Bar dataKey="Avg Demand" fill="#22a362" radius={[6,6,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Monthly pattern + Radar */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="chart-container">
          <h2 className="text-base font-semibold text-white mb-1 flex items-center gap-2">
            <Thermometer size={16} className="text-accent-400" /> Temperature vs Demand
          </h2>
          <p className="text-xs text-gray-500 mb-4">Monthly averages — weather-demand relationship</p>
          {ml ? <div className="h-48 bg-white/5 rounded-xl animate-pulse" /> : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={monthlySeasonality} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" tick={{ fill: '#6b7280', fontSize: 11 }} tickLine={false} />
                <YAxis yAxisId="left"  tick={{ fill: '#6b7280', fontSize: 11 }} tickLine={false} axisLine={false}
                       tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: '#6b7280', fontSize: 11 }}
                       tickLine={false} axisLine={false} tickFormatter={v => `${v}°`} />
                <Tooltip content={<Tip />} />
                <Legend wrapperStyle={{ fontSize: 12, color: '#9ca3af' }} />
                <Line yAxisId="left"  type="monotone" dataKey="Avg Demand" stroke="#22a362" strokeWidth={2} dot />
                <Line yAxisId="right" type="monotone" dataKey="Avg Temp"   stroke="#f59e0b" strokeWidth={2} dot />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="chart-container">
          <h2 className="text-base font-semibold text-white mb-1 flex items-center gap-2">
            <BarChart3 size={16} className="text-accent-400" /> Seasonal Demand Radar
          </h2>
          <p className="text-xs text-gray-500 mb-4">Monthly demand distribution</p>
          {ml ? <div className="h-48 bg-white/5 rounded-xl animate-pulse" /> : (
            <ResponsiveContainer width="100%" height={200}>
              <RadarChart data={radarData} outerRadius={75}>
                <PolarGrid stroke="rgba(255,255,255,0.06)" />
                <PolarAngleAxis dataKey="month" tick={{ fill: '#6b7280', fontSize: 10 }} />
                <Radar name="Avg Demand" dataKey="demand" stroke="#22a362" fill="#22a362" fillOpacity={0.25} />
              </RadarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Hourly profile */}
      <div className="chart-container">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-white">24-Hour Demand Profile by Season</h2>
            <p className="text-xs text-gray-500 mt-0.5">Average demand across all hours</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => setSeason(null)}
              className={`btn-secondary text-xs px-3 py-1.5 ${season === null ? 'border-primary-500/50 text-primary-400' : ''}`}>
              All
            </button>
            {[1,2,3,4].map(s => (
              <button key={s} onClick={() => setSeason(s)}
                className={`btn-secondary text-xs px-3 py-1.5 ${season === s ? 'border-primary-500/50 text-primary-400' : ''}`}>
                {SEASON_NAMES[s]}
              </button>
            ))}
          </div>
        </div>
        {hl ? <div className="h-56 bg-white/5 rounded-xl animate-pulse" /> : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={hourlySeasons} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" tick={{ fill: '#6b7280', fontSize: 10 }} tickLine={false} interval={2} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} tickLine={false} axisLine={false}
                     tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
              <Tooltip content={<Tip />} />
              <Legend wrapperStyle={{ fontSize: 12, color: '#9ca3af' }} />
              {season === null
                ? [1,2,3,4].map(s => (
                    <Line key={s} type="monotone" dataKey={SEASON_NAMES[s]}
                          stroke={SEASON_COLORS[s]} strokeWidth={2} dot={false} />
                  ))
                : <Line type="monotone" dataKey={SEASON_NAMES[season]}
                        stroke={SEASON_COLORS[season]} strokeWidth={2.5} dot={false} />
              }
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
