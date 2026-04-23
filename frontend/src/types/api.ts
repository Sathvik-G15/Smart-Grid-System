// ── API Types — Multi-Location Grid Demand Model ─────────────────────────────

export interface Location {
  location_id:      string;
  location:         string;
  lat:              number;
  lon:              number;
  location_enc:     number;
  n_buildings:      number;
  n_buildings_norm: number;
  mean_demand_kwh:  number;
}

export interface MetricsBlock {
  rmse: number;
  mae:  number;
  r2:   number;
  mape: number;
}

export interface ModelStats {
  model: {
    type:          string;
    n_estimators:  number;
    features:      number;
    n_locations:   number;
    train_samples: number;
    val_samples:   number;
    test_samples:  number;
    split:         string;
    interval:      string;
  };
  performance: {
    validation:   MetricsBlock;
    test:         MetricsBlock;
    per_location: Record<string, MetricsBlock>;
  };
}

export interface PredictRequest {
  mode:                 'city' | 'coordinate';
  location_id:          string;
  date:                 string;
  hour:                 number;
  custom_lat?:          number;
  custom_lon?:          number;
  temperature_2m?:       number;
  relative_humidity_2m?: number;
  wind_speed_10m?:       number;
  pressure_msl?:         number;
  cloud_cover?:          number;
}

export interface PredictResponse {
  predicted_demand_kwh: number;
  prediction_lower:     number;
  prediction_upper:     number;
  location:             string;
  location_id:          string;
  date:                 string;
  hour:                 number;
  season:               string;
  confidence:           string;
  input_features:       Record<string, number>;
}

export interface DailyRecord {
  location:    string;
  date:        string;
  peak_demand: number;
  min_demand:  number;
  avg_demand:  number;
  avg_temp:    number;
  avg_wind:    number;
  avg_solar:   number;
}

export interface MonthlyRecord {
  location:    string;
  year:        number;
  month:       number;
  avg_demand:  number;
  peak_demand: number;
  avg_temp:    number;
  avg_wind:    number;
}

export interface HourlyProfileRecord {
  location:   string;
  season:     number;
  hour:       number;
  avg_demand: number;
  std_demand: number;
}

export interface FeatureImportance {
  feature:    string;
  importance: number;
}

export interface ForecastDay {
  date:    string;
  periods: { hour: number; hour_label: string; predicted_kwh: number }[];
  peak_kwh: number;
  avg_kwh:  number;
}
