import { useState, useMemo, useEffect } from 'react';
import { api } from '../services/api';
import { useFetch } from '../hooks/useFetch';
import type { PredictResponse } from '../types/api';
import axios from 'axios';
import { MapContainer, TileLayer, CircleMarker, Popup, useMapEvents, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import {
  Zap, Calendar, Clock, Thermometer, Wind, Droplets,
  ChevronRight, Loader2, AlertCircle, MapPin, Gauge, RefreshCw, CheckCircle2,
} from 'lucide-react';
import toast from 'react-hot-toast';

// Fix default Leaflet icon paths in Vite/Webpack
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({ iconUrl: markerIcon, iconRetinaUrl: markerIcon2x, shadowUrl: markerShadow });

const SEASONS = ['', 'Winter', 'Spring', 'Summer', 'Autumn'];
const SEASON_EMOJI: Record<string, string> = {
  Winter: '❄️', Spring: '🌸', Summer: '☀️', Autumn: '🍂',
};

function MapClickHandler({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({ click(e) { onClick(e.latlng.lat, e.latlng.lng); } });
  return null;
}

function MapCenterUpdater({ lat, lon }: { lat: number; lon: number }) {
  const map = useMap();
  useEffect(() => { map.setView([lat, lon]); }, [lat, lon, map]);
  return null;
}

function ResultGauge({ value, max, unit }: { value: number; max: number; unit: 'MWh' | 'kWh' }) {
  const pct   = Math.min(100, Math.max(0, (value / max) * 100));
  const color = pct < 40 ? '#22a362' : pct < 70 ? '#f59e0b' : '#ef4444';
  const circumference = 2 * Math.PI * 54;
  const dash = (pct / 100) * circumference;
  const displayValue = unit === 'MWh' ? (value / 1000).toFixed(1) : value.toFixed(1);
  return (
    <div className="relative flex items-center justify-center w-36 h-36 mx-auto">
      <svg width="144" height="144" viewBox="0 0 144 144" className="-rotate-90">
        <circle cx="72" cy="72" r="54" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="10" />
        <circle cx="72" cy="72" r="54" fill="none" stroke={color} strokeWidth="10"
          strokeDasharray={`${dash} ${circumference}`} strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.8s ease' }} />
      </svg>
      <div className="absolute text-center">
        <p className="text-xl font-bold text-white leading-none">{displayValue}</p>
        <p className="text-xs text-gray-400 mt-0.5">{unit}</p>
      </div>
    </div>
  );
}

export default function Predict() {
  const today = new Date().toISOString().split('T')[0];
  const { data: locations } = useFetch(() => api.locations(), []);

  // Deduplicate locations by name for display
  const uniqueLocations = useMemo(() => {
    const seen = new Set<string>();
    return (locations ?? []).filter(l => {
      if (seen.has(l.location_id)) return false;
      seen.add(l.location_id);
      return true;
    });
  }, [locations]);

  const [form, setForm] = useState({
    location_id:          'gcpvj4cmfb0f',
    date:                 today,
    hour:                 12,
    temperature_2m:       '',
    relative_humidity_2m: '',
    wind_speed_10m:       '',
    pressure_msl:         '',
    cloud_cover:          '',
  });
  const [mode, setMode] = useState<'city' | 'coordinate'>('city');
  const [customLat, setCustomLat] = useState<number | null>(null);
  const [customLon, setCustomLon] = useState<number | null>(null);
  
  const [weatherFetched, setWeatherFetched] = useState(false);
  const [fetchingWeather, setFetchingWeather] = useState(false);
  const [result,  setResult]  = useState<PredictResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const set = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  // Auto-fetch weather when location changes
  useEffect(() => {
    setWeatherFetched(false);
    fetchWeather(form.location_id, customLat, customLon);
  }, [form.location_id]);

  function handleCityChange(locId: string) {
    set('location_id', locId);
    setCustomLat(null);
    setCustomLon(null);
  }

  function handleMapClick(lat: number, lng: number) {
    setCustomLat(lat);
    setCustomLon(lng);
    fetchWeather(form.location_id, lat, lng);
  }

  async function fetchWeather(locId: string, lat?: number | null, lon?: number | null) {
    setFetchingWeather(true);
    try {
      const q = (lat !== undefined && lat !== null && lon !== undefined && lon !== null) 
        ? `?lat=${lat}&lon=${lon}` : '';
      const r = await axios.get(`http://localhost:8000/api/weather/${locId}${q}`);
      const w = r.data;
      setForm(f => ({
        ...f,
        temperature_2m:       String(w.temperature_2m.toFixed(1)),
        relative_humidity_2m: String(Math.round(w.relative_humidity_2m)),
        wind_speed_10m:       String(w.wind_speed_10m.toFixed(1)),
        pressure_msl:         String(w.pressure_msl.toFixed(1)),
        cloud_cover:          String(Math.round(w.cloud_cover)),
      }));
      setWeatherFetched(true);
      toast.success(lat ? `Live weather loaded for custom pin` : `Live weather loaded for ${w.location}`, { icon: '🌤️' });
    } catch {
      toast.error('Could not fetch live weather — you can enter values manually');
    } finally {
      setFetchingWeather(false);
    }
  }

  // Max demand for gauge
  const locMeta = useMemo(() =>
    locations?.find(l => l.location_id === form.location_id),
    [locations, form.location_id]);
  const gaugeMax = mode === 'city' ? (locMeta ? locMeta.mean_demand_kwh * 4 : 100000) : 15;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === 'coordinate' && (customLat === null || customLon === null)) {
        toast.error("Please select a coordinate on the map.");
        return;
    }
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await api.predict({
        mode,
        location_id:          form.location_id,
        date:                 form.date,
        hour:                 Number(form.hour),
        custom_lat:           customLat ?? undefined,
        custom_lon:           customLon ?? undefined,
        temperature_2m:       form.temperature_2m       !== '' ? Number(form.temperature_2m)       : undefined,
        relative_humidity_2m: form.relative_humidity_2m !== '' ? Number(form.relative_humidity_2m) : undefined,
        wind_speed_10m:       form.wind_speed_10m       !== '' ? Number(form.wind_speed_10m)       : undefined,
        pressure_msl:         form.pressure_msl         !== '' ? Number(form.pressure_msl)         : undefined,
        cloud_cover:          form.cloud_cover          !== '' ? Number(form.cloud_cover)          : undefined,
      });
      setResult(res);
      toast.success('Prediction ready!');
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err.message || 'Prediction failed';
      setError(msg); toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-5xl space-y-6 animate-fade-in">
      <div>
        <h1 className="section-title">Demand <span className="glow-text">Predictor</span></h1>
        <p className="section-subtitle">
          Multi-location AI demand forecasting · XGBoost · R² = {0.9984}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Form */}
        <div className="lg:col-span-3 card-glow">
          <h2 className="text-base font-semibold text-white mb-5 flex items-center gap-2">
            <Zap size={16} className="text-primary-400" /> Forecast Inputs
          </h2>
          <form onSubmit={handleSubmit} className="space-y-5">

            {/* Mode Toggle */}
            <div className="flex bg-dark-900 rounded-lg p-1 border border-white/5">
              <button
                type="button"
                onClick={() => setMode('city')}
                className={`flex-1 py-2 text-sm font-semibold rounded-md transition-all ${mode === 'city' ? 'bg-primary-600 text-white shadow' : 'text-gray-400 hover:text-gray-300'}`}
              >
                City Grid (Aggregated)
              </button>
              <button
                type="button"
                onClick={() => setMode('coordinate')}
                className={`flex-1 py-2 text-sm font-semibold rounded-md transition-all ${mode === 'coordinate' ? 'bg-primary-600 text-white shadow' : 'text-gray-400 hover:text-gray-300'}`}
              >
                Specific Coordinate (Building)
              </button>
            </div>

            {/* Location Selection: Dropdown + Map */}
            <div className="space-y-4">
              {/* Base City Dropdown */}
              {mode === 'city' && (
                <div className="animate-fade-in">
                  <label className="label">
                    <MapPin size={13} className="inline mr-1 text-gray-500" /> Base City
                  </label>
                  <select
                    value={form.location_id}
                    onChange={e => handleCityChange(e.target.value)}
                    className="input-field"
                    required
                  >
                    {uniqueLocations.map(l => (
                      <option key={l.location_id} value={l.location_id}>{l.location}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Coordinates Map */}
              {mode === 'coordinate' && (
                <div className="animate-fade-in">
                  <label className="label mb-2">
                    <MapPin size={13} className="inline mr-1 text-gray-500" /> Pinpoint Exact Coordinates
                  </label>
                  <div className="h-64 rounded-xl overflow-hidden border border-white/10 relative z-0">
                    <MapContainer
                      center={[locMeta?.lat ?? 40, locMeta?.lon ?? -20]}
                      zoom={9}
                      style={{ height: '100%', width: '100%', background: '#0d1520' }}
                      scrollWheelZoom={true}
                    >
                      <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
                      {locMeta && <MapCenterUpdater lat={customLat ?? locMeta.lat} lon={customLon ?? locMeta.lon} />}
                      {customLat && customLon && (
                         <CircleMarker
                           center={[customLat, customLon]} radius={8}
                           pathOptions={{ color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 0.9, weight: 3 }}
                         >
                           <Popup><p className="font-bold text-xs text-gray-800">Custom Pin</p></Popup>
                         </CircleMarker>
                      )}
                      <MapClickHandler onClick={handleMapClick} />
                    </MapContainer>
                  </div>
                  <div className="flex justify-between text-xs mt-2">
                    <span className="text-gray-500">
                      {customLat ? `Lat: ${customLat.toFixed(4)}, Lon: ${customLon?.toFixed(4)}` : 'Click map to pin custom coordinates'}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Date + Hour */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">
                  <Calendar size={13} className="inline mr-1 text-gray-500" /> Date
                </label>
                <input type="date" value={form.date}
                  onChange={e => set('date', e.target.value)}
                  className="input-field" required />
              </div>
              <div>
                <label className="label">
                  <Clock size={13} className="inline mr-1 text-gray-500" />
                  Hour &nbsp;<span className="text-gray-600 text-xs">(= {String(form.hour).padStart(2, '0')}:00)</span>
                </label>
                <input type="number" min={0} max={23}
                  value={form.hour}
                  onChange={e => set('hour', e.target.value)}
                  className="input-field" required />
              </div>
            </div>

            {/* Hour slider */}
            <div>
              <div className="flex justify-between text-xs text-gray-600 mb-1">
                <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span>
              </div>
              <input type="range" min={0} max={23} step={1}
                value={form.hour}
                onChange={e => set('hour', Number(e.target.value))}
                className="w-full h-2 bg-dark-900 rounded-full appearance-none cursor-pointer
                           [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4
                           [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full
                           [&::-webkit-slider-thumb]:bg-primary-500"
              />
            </div>

            {/* Weather inputs */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">
                  Weather Conditions
                  {weatherFetched && (
                    <span className="ml-2 normal-case inline-flex items-center gap-1 text-primary-400">
                      <CheckCircle2 size={11} /> Live from Open-Meteo
                    </span>
                  )}
                </p>
                <button
                  type="button"
                  onClick={() => fetchWeather(form.location_id, customLat, customLon)}
                  disabled={fetchingWeather}
                  className="btn-secondary text-xs px-2.5 py-1 flex items-center gap-1.5"
                >
                  {fetchingWeather
                    ? <Loader2 size={12} className="animate-spin" />
                    : <RefreshCw size={12} />}
                  Refresh
                </button>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">
                    <Thermometer size={13} className="inline mr-1 text-gray-500" /> Temperature (°C)
                  </label>
                  <input type="number" min={-30} max={55} step={0.1}
                    placeholder="e.g. 18.5"
                    value={form.temperature_2m}
                    onChange={e => set('temperature_2m', e.target.value)}
                    className="input-field" />
                </div>
                <div>
                  <label className="label">
                    <Droplets size={13} className="inline mr-1 text-gray-500" /> Humidity (%)
                  </label>
                  <input type="number" min={0} max={100}
                    placeholder="e.g. 65"
                    value={form.relative_humidity_2m}
                    onChange={e => set('relative_humidity_2m', e.target.value)}
                    className="input-field" />
                </div>
                <div>
                  <label className="label">
                    <Wind size={13} className="inline mr-1 text-gray-500" /> Wind Speed (km/h)
                  </label>
                  <input type="number" min={0} max={150} step={0.1}
                    placeholder="e.g. 12"
                    value={form.wind_speed_10m}
                    onChange={e => set('wind_speed_10m', e.target.value)}
                    className="input-field" />
                </div>
                <div>
                  <label className="label">
                    <Gauge size={13} className="inline mr-1 text-gray-500" /> Pressure (hPa)
                  </label>
                  <input type="number" min={950} max={1060} step={0.1}
                    placeholder="e.g. 1013"
                    value={form.pressure_msl}
                    onChange={e => set('pressure_msl', e.target.value)}
                    className="input-field" />
                </div>
              </div>
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full justify-center">
              {loading
                ? <><Loader2 size={16} className="animate-spin" /> Predicting...</>
                : <><Zap size={16} /> Predict Demand <ChevronRight size={15} /></>
              }
            </button>
          </form>
        </div>

        {/* Result panel */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          {error && (
            <div className="card border-rose-500/20 bg-rose-500/5">
              <div className="flex items-start gap-3">
                <AlertCircle size={18} className="text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-rose-400">Prediction Failed</p>
                  <p className="text-xs text-gray-400 mt-1">{error}</p>
                </div>
              </div>
            </div>
          )}

          {!result && !error && !loading && (
            <div className="card-glow flex-1 flex flex-col items-center justify-center text-center py-12">
              <div className="w-16 h-16 rounded-2xl bg-primary-600/15 border border-primary-500/20 flex items-center justify-center mb-4">
                <Zap size={28} className="text-primary-400" />
              </div>
              <p className="text-gray-400 text-sm">Fill the form and click</p>
              <p className="text-gray-500 text-xs mt-1">Predict Demand to see results</p>
            </div>
          )}

          {loading && (
            <div className="card-glow flex-1 flex flex-col items-center justify-center py-12">
              <div className="w-16 h-16 rounded-full border-2 border-primary-600/30 border-t-primary-500 animate-spin mb-4" />
              <p className="text-gray-400 text-sm">Running XGBoost model...</p>
            </div>
          )}

          {result && !loading && (
            <div className="card-glow animate-slide-up">
              <div className="text-center mb-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">
                  {result.location} · {result.date} · {String(result.hour).padStart(2, '0')}:00
                </p>
                <ResultGauge value={result.predicted_demand_kwh} max={gaugeMax} unit={mode === 'city' ? 'MWh' : 'kWh'} />
                <p className="text-3xl font-bold text-white mt-2">
                  {mode === 'city' 
                    ? result.predicted_demand_kwh.toLocaleString(undefined, { maximumFractionDigits: 0 }) 
                    : result.predicted_demand_kwh.toFixed(2)}
                  <span className="text-lg text-gray-400"> kWh</span>
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  95% CI: {result.prediction_lower.toFixed(mode === 'city' ? 0 : 2)} – {result.prediction_upper.toFixed(mode === 'city' ? 0 : 2)} kWh
                </p>
              </div>

              <div className="space-y-2 mt-4 border-t border-white/5 pt-4">
                {[
                  { label: 'Location',   val: result.location },
                  { label: 'Season',     val: `${SEASON_EMOJI[result.season] ?? ''} ${result.season}` },
                  { label: 'Time',       val: `${String(result.hour).padStart(2, '0')}:00` },
                  { label: 'Confidence', val: result.confidence },
                ].map(({ label, val }) => (
                  <div key={label} className="flex justify-between text-xs">
                    <span className="text-gray-500">{label}</span>
                    <span className="text-gray-200 font-medium">{val}</span>
                  </div>
                ))}
              </div>

              <details className="mt-4">
                <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-400">
                  View input features
                </summary>
                <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                  {Object.entries(result.input_features).map(([k, v]) => (
                    <div key={k} className="flex justify-between text-xs px-2 py-0.5 rounded bg-dark-900/60">
                      <span className="text-gray-500 font-mono">{k}</span>
                      <span className="text-gray-300 font-mono">{typeof v === 'number' ? v.toFixed(3) : v}</span>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
