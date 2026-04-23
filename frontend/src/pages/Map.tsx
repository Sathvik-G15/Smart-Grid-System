import { useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, CircleMarker } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { api } from '../services/api';
import { useFetch } from '../hooks/useFetch';
import { MapPin, Zap, Building2, TrendingUp } from 'lucide-react';

// Fix default Leaflet icon paths in Vite/Webpack
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({ iconUrl: markerIcon, iconRetinaUrl: markerIcon2x, shadowUrl: markerShadow });

// Metadata: per-location R² from model
const PER_LOC_R2: Record<string, number> = {
  'London, UK':                 0.9620,
  'PT':                        0.9898,
  'Washington DC, USA':        0.9661,
  'Minneapolis, Minnesota, USA':0.9804,
  'Cardiff, UK':               0.9692,
  'Phoenix, Arizona, USA':     0.9244,
  'Orlando, Florida, USA':     0.9466,
  'Austin, Texas, USA':        0.3632,
  'Ithaca, New York, USA':     0.9614,
  'Ottawa, CA':                0.9768,
  'Princeton, New Jersey, USA':0.9601,
  'Oakland, California, USA':  0.9301,
  'Groningen, NL':             0.9769,
};

function r2ToColor(r2: number): string {
  if (r2 >= 0.97) return '#22a362';
  if (r2 >= 0.93) return '#0ea5e9';
  if (r2 >= 0.85) return '#f59e0b';
  return '#ef4444';
}

function r2ToRadius(r2: number): number {
  return 8 + r2 * 14;
}

export default function Map() {
  const { data: locations, loading } = useFetch(() => api.locations(), []);
  const { data: stats }              = useFetch(() => api.stats(), []);
  const [selected, setSelected]      = useState<string | null>(null);

  // Deduplicate by location name, pick max mean demand
  const dedupedLocs = useMemo(() => {
    if (!locations) return [];
    const map = new Map<string, typeof locations[0]>();
    for (const l of locations) {
      const existing = map.get(l.location);
      if (!existing || l.mean_demand_kwh > existing.mean_demand_kwh) {
        map.set(l.location, l);
      }
    }
    return Array.from(map.values());
  }, [locations]);

  const selectedLoc = useMemo(() =>
    dedupedLocs.find(l => l.location === selected),
    [dedupedLocs, selected]);

  const perLocMetrics = stats?.performance?.per_location ?? {};

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="section-title">
          Grid <span className="glow-text">Map</span>
        </h1>
        <p className="section-subtitle">
          Interactive map of all {dedupedLocs.length} grid locations · circle size & colour = model R²
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Map */}
        <div className="lg:col-span-2 rounded-2xl overflow-hidden border border-white/10 shadow-2xl" style={{ height: 520 }}>
          {loading ? (
            <div className="h-full bg-white/5 animate-pulse flex items-center justify-center">
              <p className="text-gray-500 text-sm">Loading map...</p>
            </div>
          ) : (
            <MapContainer
              center={[40, -20]}
              zoom={2}
              style={{ height: '100%', width: '100%', background: '#0d1520' }}
              scrollWheelZoom
            >
              <TileLayer
                attribution='&copy; <a href="https://carto.com/">CARTO</a>'
                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              />
              {dedupedLocs.map(loc => {
                const r2     = PER_LOC_R2[loc.location] ?? 0.95;
                const color  = r2ToColor(r2);
                const radius = r2ToRadius(r2);
                return (
                  <CircleMarker
                    key={loc.location_id}
                    center={[loc.lat, loc.lon]}
                    radius={radius}
                    pathOptions={{
                      color,
                      fillColor: color,
                      fillOpacity: selected === loc.location ? 0.95 : 0.65,
                      weight: selected === loc.location ? 3 : 1.5,
                    }}
                    eventHandlers={{ click: () => setSelected(loc.location) }}
                  >
                    <Popup>
                      <div className="text-xs space-y-1 min-w-[160px]">
                        <p className="font-bold text-sm">{loc.location}</p>
                        <p>Buildings: <b>{Math.round(loc.n_buildings)}</b></p>
                        <p>Avg demand: <b>{loc.mean_demand_kwh.toFixed(0)} kWh</b></p>
                        <p>R²: <b style={{ color }}>{r2.toFixed(4)}</b></p>
                      </div>
                    </Popup>
                  </CircleMarker>
                );
              })}
            </MapContainer>
          )}
        </div>

        {/* Sidebar */}
        <div className="flex flex-col gap-4">
          {/* Legend */}
          <div className="card-glow">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <MapPin size={14} className="text-primary-400" /> Legend
            </h3>
            <div className="space-y-2">
              {[
                { color: '#22a362', label: 'R² ≥ 0.97 — Excellent' },
                { color: '#0ea5e9', label: 'R² ≥ 0.93 — Very good' },
                { color: '#f59e0b', label: 'R² ≥ 0.85 — Good'      },
                { color: '#ef4444', label: 'R² < 0.85 — Fair'       },
              ].map(({ color, label }) => (
                <div key={label} className="flex items-center gap-2 text-xs text-gray-400">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ background: color }} />
                  {label}
                </div>
              ))}
              <p className="text-xs text-gray-600 mt-2">Circle size also scales with R²</p>
            </div>
          </div>

          {/* Selected location detail */}
          {selectedLoc ? (
            <div className="card-glow border-primary-500/20 bg-primary-600/5 animate-slide-up">
              <h3 className="text-sm font-semibold text-primary-400 mb-3">{selectedLoc.location}</h3>
              <div className="space-y-2">
                {[
                  { k: 'Lat / Lon', v: `${selectedLoc.lat.toFixed(2)}, ${selectedLoc.lon.toFixed(2)}` },
                  { k: 'Buildings', v: Math.round(selectedLoc.n_buildings).toString() },
                  { k: 'Avg Demand', v: `${selectedLoc.mean_demand_kwh.toFixed(0)} kWh` },
                  { k: 'R² Score',   v: (PER_LOC_R2[selectedLoc.location] ?? 0).toFixed(4) },
                  { k: 'RMSE',
                    v: perLocMetrics[selectedLoc.location]
                      ? `${perLocMetrics[selectedLoc.location].rmse.toFixed(0)} kWh`
                      : '—'
                  },
                  { k: 'MAPE',
                    v: perLocMetrics[selectedLoc.location]
                      ? `${perLocMetrics[selectedLoc.location].mape.toFixed(2)}%`
                      : '—'
                  },
                ].map(({ k, v }) => (
                  <div key={k} className="flex justify-between text-xs">
                    <span className="text-gray-500">{k}</span>
                    <span className="text-gray-200 font-medium">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="card-glow flex-1 flex flex-col items-center justify-center text-center py-8">
              <MapPin size={28} className="text-gray-600 mb-3" />
              <p className="text-gray-500 text-sm">Click a location</p>
              <p className="text-gray-600 text-xs mt-1">to see its details</p>
            </div>
          )}

          {/* All locations list */}
          <div className="card-glow overflow-hidden">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <Building2 size={14} className="text-accent-400" /> All Locations
            </h3>
            <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
              {dedupedLocs
                .sort((a, b) => (PER_LOC_R2[b.location] ?? 0) - (PER_LOC_R2[a.location] ?? 0))
                .map(loc => {
                  const r2    = PER_LOC_R2[loc.location] ?? 0;
                  const color = r2ToColor(r2);
                  return (
                    <button
                      key={loc.location_id}
                      onClick={() => setSelected(loc.location)}
                      className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs
                        transition-colors hover:bg-white/5
                        ${selected === loc.location ? 'bg-primary-600/15 border border-primary-500/20' : ''}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                        <span className="text-gray-300 truncate text-left">{loc.location}</span>
                      </div>
                      <span className="font-bold ml-2 shrink-0" style={{ color }}>{r2.toFixed(3)}</span>
                    </button>
                  );
                })}
            </div>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { icon: <MapPin size={18} className="text-primary-400" />,  label: 'Grid Locations', val: dedupedLocs.length.toString(), accent: 'green' },
          { icon: <Building2 size={18} className="text-accent-400" />, label: 'Total Buildings',
            val: dedupedLocs.reduce((s, l) => s + Math.round(l.n_buildings), 0).toLocaleString(), accent: 'blue' },
          { icon: <TrendingUp size={18} className="text-amber-400" />, label: 'Overall R²',
            val: stats ? stats.performance.test.r2.toFixed(4) : '—', accent: 'amber' },
          { icon: <Zap size={18} className="text-rose-400" />,        label: 'Best Location',
            val: dedupedLocs.length > 0
              ? dedupedLocs.sort((a,b) => (PER_LOC_R2[b.location]??0)-(PER_LOC_R2[a.location]??0))[0]?.location.split(',')[0]
              : '—',
            accent: 'rose' },
        ].map(({ icon, label, val, accent }) => (
          <div key={label} className={`card border-${accent === 'green' ? 'primary' : accent === 'blue' ? 'accent' : accent}-500/15 bg-${accent === 'green' ? 'primary' : accent === 'blue' ? 'accent' : accent}-600/5`}>
            <div className="flex items-center gap-2 mb-2">{icon}<span className="text-xs text-gray-400">{label}</span></div>
            <p className="text-xl font-bold text-white truncate">{val}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
