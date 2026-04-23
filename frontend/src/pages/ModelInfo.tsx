import { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { api } from '../services/api';
import { useFetch } from '../hooks/useFetch';
import StatCard from '../components/StatCard';
import { BrainCircuit, Database, Target, FlaskConical, CheckCircle2, TrendingUp, MapPin } from 'lucide-react';

const FEATURE_COLORS = [
  '#22a362','#1a8f55','#147a48','#0f663c','#0a5230',
  '#0ea5e9','#0284c7','#0369a1','#0c4a6e',
  '#fbbf24','#f59e0b','#d97706','#b45309',
  '#f97316','#ea580c','#c2410c',
  '#a78bfa','#8b5cf6','#7c3aed','#6d28d9',
];

const STEPS = [
  { label: 'Raw Parquet',        desc: '238M rows · 3 tables (demand, metadata, weather)', color: 'blue' },
  { label: 'Location Aggregation', desc: 'Sum demand per location+timestamp · join weather', color: 'blue' },
  { label: 'Feature Engineering', desc: 'Datetime · weather · location identity · lag/rolling', color: 'green' },
  { label: 'Per-Location Split', desc: '70/15/15 chronological split per location', color: 'amber' },
  { label: 'XGBoost Training',   desc: '1000 estimators · log1p target · early stopping', color: 'rose' },
  { label: 'Evaluation',         desc: 'R²=0.9984 · RMSE=3433 kWh · MAPE=5.75%', color: 'green' },
];

const Tip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-dark-850 border border-white/10 rounded-xl p-3 shadow-2xl text-xs">
      <p className="text-gray-400 font-mono mb-1">{label}</p>
      <p className="text-white font-bold">{(payload[0].value * 100).toFixed(2)}%</p>
    </div>
  );
};

export default function ModelInfo() {
  const { data: stats, loading: sl } = useFetch(() => api.stats(), []);
  const { data: fi,    loading: fl } = useFetch(() => api.featureImportance(), []);

  const fiChart = useMemo(() => {
    if (!fi) return [];
    return fi.map((f, i) => ({ name: f.feature, value: f.importance, color: FEATURE_COLORS[i % FEATURE_COLORS.length] }));
  }, [fi]);

  const perLocRows = useMemo(() => {
    if (!stats) return [];
    return Object.entries(stats.performance.per_location)
      .sort((a, b) => b[1].r2 - a[1].r2);
  }, [stats]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="section-title">Model <span className="glow-text">Information</span></h1>
        <p className="section-subtitle">Multi-location XGBoost · 14 grid sites · log1p demand target</p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          title="R² Score (Test)"
          value={stats ? stats.performance.test.r2.toFixed(4) : '—'}
          subtitle="Near-perfect fit"
          icon={<Target size={18} className="text-primary-400" />}
          accent="green" loading={sl}
        />
        <StatCard
          title="RMSE (Test)"
          value={stats ? `${stats.performance.test.rmse.toFixed(0)} kWh` : '—'}
          subtitle="Root mean squared error"
          icon={<TrendingUp size={18} className="text-accent-400" />}
          accent="blue" loading={sl}
        />
        <StatCard
          title="MAPE (Test)"
          value={stats ? `${stats.performance.test.mape.toFixed(2)}%` : '—'}
          subtitle="Mean absolute % error"
          icon={<FlaskConical size={18} className="text-amber-400" />}
          accent="amber" loading={sl}
        />
        <StatCard
          title="Locations"
          value={stats ? String(stats.model.n_locations) : '—'}
          subtitle="Global grid sites"
          icon={<MapPin size={18} className="text-rose-400" />}
          accent="rose" loading={sl}
        />
      </div>

      {/* Pipeline */}
      <div className="card-glow">
        <h2 className="text-base font-semibold text-white mb-5 flex items-center gap-2">
          <BrainCircuit size={16} className="text-primary-400" /> ML Pipeline
        </h2>
        <div className="flex flex-wrap gap-0">
          {STEPS.map((step, i) => (
            <div key={i} className="flex items-center">
              <div className="flex flex-col items-center">
                <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs font-bold
                  ${step.color === 'green' ? 'border-primary-500 bg-primary-600/20 text-primary-400' :
                    step.color === 'blue'  ? 'border-accent-500  bg-accent-600/20  text-accent-400'  :
                    step.color === 'amber' ? 'border-amber-500   bg-amber-600/20   text-amber-400'   :
                                            'border-rose-500    bg-rose-600/20    text-rose-400'    }`}
                >
                  {i === STEPS.length - 1 ? <CheckCircle2 size={14} /> : i + 1}
                </div>
                <div className="mt-2 text-center max-w-[120px]">
                  <p className="text-xs font-semibold text-gray-200">{step.label}</p>
                  <p className="text-xs text-gray-500 mt-0.5 leading-tight">{step.desc}</p>
                </div>
              </div>
              {i < STEPS.length - 1 && (
                <div className="w-8 h-0.5 bg-gradient-to-r from-white/10 to-white/5 mx-1 mb-6" />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Feature importance + config */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 chart-container">
          <h2 className="text-base font-semibold text-white mb-1">Feature Importance</h2>
          <p className="text-xs text-gray-500 mb-4">Top 20 features by XGBoost gain</p>
          {fl ? <div className="h-72 bg-white/5 rounded-xl animate-pulse" /> : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={fiChart} layout="vertical" margin={{ top: 4, right: 10, left: 120, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 10 }} tickLine={false}
                       tickFormatter={v => `${(v*100).toFixed(1)}%`} />
                <YAxis type="category" dataKey="name" tick={{ fill: '#9ca3af', fontSize: 10 }}
                       tickLine={false} axisLine={false} width={115} />
                <Tooltip content={<Tip />} />
                <Bar dataKey="value" radius={[0,4,4,0]}>
                  {fiChart.map((f, i) => <Cell key={i} fill={f.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="space-y-4">
          <div className="card-glow">
            <h3 className="text-sm font-semibold text-white mb-3">Model Configuration</h3>
            <div className="space-y-2">
              {[
                { k: 'Algorithm',    v: 'XGBoost Regressor'      },
                { k: 'n_estimators', v: stats ? String(stats.model.n_estimators) : '—' },
                { k: 'max_depth',    v: '8'                       },
                { k: 'learning_rate',v: '0.05'                    },
                { k: 'Target',       v: 'log1p(kWh)'              },
                { k: 'Split',        v: '70/15/15 per-loc'        },
                { k: 'Features',     v: stats ? String(stats.model.features) : '—' },
              ].map(({ k, v }) => (
                <div key={k} className="flex justify-between text-xs">
                  <span className="text-gray-500 font-mono">{k}</span>
                  <span className="text-gray-200">{v}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card-glow">
            <h3 className="text-sm font-semibold text-white mb-3">Dataset Summary</h3>
            <div className="space-y-2">
              {[
                { k: 'Source datasets', v: '3 (London SM, BDG2, ELD)' },
                { k: 'Date range',      v: '2011 – 2017'               },
                { k: 'Granularity',     v: '1H (resampled)'            },
                { k: 'Locations',       v: stats ? `${stats.model.n_locations}` : '—' },
                { k: 'Train',  v: stats ? `${(stats.model.train_samples/1000).toFixed(0)}K` : '—' },
                { k: 'Val',    v: stats ? `${(stats.model.val_samples/1000).toFixed(0)}K`   : '—' },
                { k: 'Test',   v: stats ? `${(stats.model.test_samples/1000).toFixed(0)}K`  : '—' },
              ].map(({ k, v }) => (
                <div key={k} className="flex justify-between text-xs">
                  <span className="text-gray-500">{k}</span>
                  <span className="text-gray-200 font-medium">{v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Val vs Test */}
          <div className="card-glow border-primary-500/20 bg-primary-600/5">
            <h3 className="text-sm font-semibold text-primary-400 mb-3">Val vs Test Performance</h3>
            <div className="space-y-2">
              {stats && [
                { label: 'RMSE', valV: stats.performance.validation.rmse.toFixed(0), testV: stats.performance.test.rmse.toFixed(0), unit: ' kWh' },
                { label: 'MAE',  valV: stats.performance.validation.mae.toFixed(0),  testV: stats.performance.test.mae.toFixed(0),  unit: ' kWh' },
                { label: 'R²',   valV: stats.performance.validation.r2.toFixed(4),   testV: stats.performance.test.r2.toFixed(4),   unit: '' },
                { label: 'MAPE', valV: stats.performance.validation.mape.toFixed(2), testV: stats.performance.test.mape.toFixed(2), unit: '%' },
              ].map(row => (
                <div key={row.label} className="text-xs">
                  <div className="flex justify-between text-gray-500 mb-0.5">
                    <span>{row.label}</span>
                    <span className="flex gap-4">
                      <span>Val: <span className="text-gray-300">{row.valV}{row.unit}</span></span>
                      <span>Test: <span className="text-primary-400 font-bold">{row.testV}{row.unit}</span></span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Per-location performance */}
      <div className="card-glow">
        <h2 className="text-base font-semibold text-white mb-1 flex items-center gap-2">
          <Database size={16} className="text-primary-400" /> Per-Location Test Performance
        </h2>
        <p className="text-xs text-gray-500 mb-4">R² / RMSE / MAPE on the held-out 15% test slice per location</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {perLocRows.map(([loc, m]) => (
            <div key={loc} className="bg-dark-900/60 rounded-xl p-3 border border-white/5">
              <p className="text-xs font-semibold text-gray-200 mb-2 truncate">{loc}</p>
              <div className="space-y-1">
                {[
                  { k: 'R²',   v: m.r2.toFixed(4),   color: m.r2 > 0.95 ? 'text-primary-400' : m.r2 > 0.85 ? 'text-amber-400' : 'text-rose-400' },
                  { k: 'RMSE', v: `${m.rmse.toFixed(0)} kWh`, color: 'text-gray-300' },
                  { k: 'MAPE', v: `${m.mape.toFixed(2)}%`,    color: 'text-gray-300' },
                ].map(({ k, v, color }) => (
                  <div key={k} className="flex justify-between text-xs">
                    <span className="text-gray-500">{k}</span>
                    <span className={`font-bold ${color}`}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
