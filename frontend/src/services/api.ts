import axios from 'axios';
import type {
  ModelStats, PredictRequest, PredictResponse, Location,
  DailyRecord, MonthlyRecord, HourlyProfileRecord,
  FeatureImportance, ForecastDay,
} from '../types/api';

const API = axios.create({ baseURL: import.meta.env.VITE_API_URL || '', timeout: 20000 });

export const api = {
  health: () => API.get('/api/health').then(r => r.data),

  stats: (): Promise<ModelStats> =>
    API.get('/api/stats').then(r => r.data),

  locations: (): Promise<Location[]> =>
    API.get('/api/locations').then(r => r.data),

  weather: (location_id: string, lat?: number, lon?: number, date?: string, hour?: number): Promise<{
    temperature_2m: number; relative_humidity_2m: number;
    wind_speed_10m: number; pressure_msl: number; cloud_cover: number;
    apparent_temperature: number; location: string;
  }> => API.get(`/api/weather/${location_id}`, { params: { lat, lon, date, hour } }).then(r => r.data),

  predict: (req: PredictRequest): Promise<PredictResponse> =>
    API.post('/api/predict', req).then(r => r.data),

  daily: (params?: { location?: string; start?: string; end?: string; limit?: number }): Promise<DailyRecord[]> =>
    API.get('/api/daily', { params }).then(r => r.data),

  monthly: (params?: { location?: string; start_year?: number; end_year?: number }): Promise<MonthlyRecord[]> =>
    API.get('/api/monthly', { params }).then(r => r.data),

  hourlyProfile: (params?: { location?: string; season?: number }): Promise<HourlyProfileRecord[]> =>
    API.get('/api/hourly-profile', { params }).then(r => r.data),

  featureImportance: (): Promise<FeatureImportance[]> =>
    API.get('/api/feature-importance').then(r => r.data),

  forecast: (location_id?: string, days?: number): Promise<ForecastDay[]> =>
    API.get('/api/forecast', { params: { location_id, days } }).then(r => r.data),
};
