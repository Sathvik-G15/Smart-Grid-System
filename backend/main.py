"""
FastAPI Backend — Multi-Location Grid Demand Prediction API
"""

import os, sys, json, math
import numpy as np
import pandas as pd
import joblib
import requests as req
from datetime import datetime, date, timedelta
from typing import Optional, List

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

BASE_DIR = os.path.dirname(__file__)
ML_DIR   = os.path.join(os.path.dirname(BASE_DIR), 'ml')
sys.path.insert(0, ML_DIR)
from feature_engineering import get_feature_columns, LOCATION_META, CLIMATE_CODES

# ── Load artifacts ─────────────────────────────────────────────────────────────
print("Loading model artifacts...")
MODEL        = joblib.load(os.path.join(BASE_DIR, 'model.pkl'))
METADATA     = json.load(open(os.path.join(BASE_DIR, 'model_metadata.json')))
DEMAND_LK    = pd.read_csv(os.path.join(BASE_DIR, 'demand_lookup.csv'))
LOC_LK       = pd.read_csv(os.path.join(BASE_DIR, 'location_lookup.csv'))
DAILY_DF     = pd.read_csv(os.path.join(BASE_DIR, 'daily_summary.csv'))
MONTHLY_DF   = pd.read_csv(os.path.join(BASE_DIR, 'monthly_summary.csv'))
HOURLY_DF    = pd.read_csv(os.path.join(BASE_DIR, 'hourly_profile.csv'))
FEATURES     = METADATA['features']
LOC_ENC_MAP  = METADATA['loc_enc_map']      # location_id -> int
LOC_STATS    = METADATA['loc_stats']         # location_id -> {mean, std, median}
print(f"  Loaded. Locations: {METADATA['n_locations']} | Features: {len(FEATURES)}")

print("Loading Coordinate Machine Learning Models...")
try:
    COORD_MODEL = joblib.load(os.path.join(BASE_DIR, 'coordinate_model.pkl'))
    with open(os.path.join(BASE_DIR, 'coordinate_metadata.json'), 'r') as f:
        COORD_METADATA = json.load(f)
    COORD_FEATURES = COORD_METADATA['features']
    print(f"  Coordinate Model Loaded. Features: {len(COORD_FEATURES)}")
except Exception as e:
    print(f"  WARNING: Could not load coordinate model: {e}")
    COORD_MODEL = None
    COORD_METADATA = {}
    COORD_FEATURES = []

app = FastAPI(
    title="Multi-Location Grid Demand Prediction API",
    description="XGBoost demand forecasting across 14 global grid locations",
    version="2.0.0",
)
app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

# ── Helpers ────────────────────────────────────────────────────────────────────
SEASON_NAMES = {1: "Winter", 2: "Spring", 3: "Summer", 4: "Autumn"}

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"

def fetch_live_weather(lat: float, lon: float) -> dict | None:
    """Fetch current weather from Open-Meteo (free, no API key)."""
    try:
        params = {
            "latitude":        lat,
            "longitude":       lon,
            "current":         "temperature_2m,relative_humidity_2m,wind_speed_10m,surface_pressure,cloud_cover,apparent_temperature,dew_point_2m,precipitation,rain,snowfall,shortwave_radiation,is_day,sunshine_duration",
            "wind_speed_unit": "kmh",
            "timezone":        "auto",
            "forecast_days":   1,
        }
        r = req.get(OPEN_METEO_URL, params=params, timeout=6)
        r.raise_for_status()
        current = r.json().get("current", {})
        return {
            "temperature_2m":       current.get("temperature_2m", 15.0),
            "apparent_temperature": current.get("apparent_temperature", 15.0),
            "relative_humidity_2m": current.get("relative_humidity_2m", 70.0),
            "dew_point_2m":         current.get("dew_point_2m", 8.0),
            "precipitation":        current.get("precipitation", 0.0),
            "rain":                 current.get("rain", 0.0),
            "snowfall":             current.get("snowfall", 0.0),
            "pressure_msl":         current.get("surface_pressure", 1013.0),
            "wind_speed_10m":       current.get("wind_speed_10m", 10.0),
            "cloud_cover":          current.get("cloud_cover", 50.0),
            "shortwave_radiation":  current.get("shortwave_radiation", 100.0),
            "is_day":               float(current.get("is_day", 1)),
            "sunshine_duration":    float(current.get("sunshine_duration", 1800.0)),
        }
    except Exception as e:
        print(f"[Weather] Open-Meteo fetch failed: {e}")
        return None

def fetch_multi_day_weather(lat: float, lon: float, days: int = 7) -> dict | None:
    """Fetch hourly weather forecast for multiple days from Open-Meteo."""
    try:
        params = {
            "latitude":        lat,
            "longitude":       lon,
            "hourly":          "temperature_2m,relative_humidity_2m,wind_speed_10m,surface_pressure,cloud_cover,shortwave_radiation",
            "wind_speed_unit": "kmh",
            "timezone":        "auto",
            "forecast_days":   days,
        }
        r = req.get(OPEN_METEO_URL, params=params, timeout=10)
        r.raise_for_status()
        return r.json().get("hourly", {})
    except Exception as e:
        print(f"[Weather] Multi-day fetch failed: {e}")
        return None

def get_season(month: int) -> int:
    if month in [12, 1, 2]: return 1
    elif month in [3, 4, 5]: return 2
    elif month in [6, 7, 8]: return 3
    else: return 4

def get_loc_row(location_id: str):
    r = LOC_LK[LOC_LK['location_id'] == location_id]
    if r.empty:
        raise HTTPException(400, f"Unknown location_id: {location_id}")
    return r.iloc[0]

def get_demand_lk(location_id: str, dow: int, hour: int) -> float:
    r = DEMAND_LK[(DEMAND_LK['location_id'] == location_id) &
                  (DEMAND_LK['day_of_week'] == dow) &
                  (DEMAND_LK['hour'] == hour)]
    if r.empty:
        r = DEMAND_LK[DEMAND_LK['location_id'] == location_id]
    return float(r['mean_demand_kwh'].iloc[0]) if not r.empty else 1000.0

# ── Pydantic models ────────────────────────────────────────────────────────────
class PredictRequest(BaseModel):
    mode:                 str   = Field("city", description="'city' or 'coordinate'")
    location_id:          str   = Field(..., example="gcpvj4cmfb0f")
    date:                 str   = Field(..., example="2024-06-15")
    hour:                 int   = Field(..., ge=0, le=23)
    custom_lat:           Optional[float] = None
    custom_lon:           Optional[float] = None
    temperature_2m:       Optional[float] = None
    relative_humidity_2m: Optional[float] = None
    wind_speed_10m:       Optional[float] = None
    pressure_msl:         Optional[float] = None
    cloud_cover:          Optional[float] = None

class PredictResponse(BaseModel):
    predicted_demand_kwh: float
    prediction_lower:     float
    prediction_upper:     float
    location:             str
    location_id:          str
    date:                 str
    hour:                 int
    season:               str
    confidence:           str
    input_features:       dict

def build_coordinate_feature_row(req: PredictRequest) -> dict:
    dt  = datetime.strptime(req.date, "%Y-%m-%d")
    dow = dt.weekday()
    season = get_season(dt.month)
    
    loc_meta = LOCATION_META.get(req.location_id, {'lat': 0.0, 'lon': 0.0})
    lat_val = req.custom_lat if req.custom_lat is not None else loc_meta['lat']
    lon_val = req.custom_lon if req.custom_lon is not None else loc_meta['lon']

    any_weather_provided = any(v is not None for v in [
        req.temperature_2m, req.relative_humidity_2m,
        req.wind_speed_10m, req.pressure_msl, req.cloud_cover,
    ])
    live_weather = fetch_live_weather(lat_val, lon_val) if not any_weather_provided else None

    def pick(user_val, live_key, default):
        if user_val is not None: return user_val
        if live_weather and live_key in live_weather: return live_weather[live_key]
        return default

    temp     = pick(req.temperature_2m,       'temperature_2m',       15.0)
    humidity = pick(req.relative_humidity_2m, 'relative_humidity_2m', 70.0)
    wind     = pick(req.wind_speed_10m,       'wind_speed_10m',       10.0)
    pressure = pick(req.pressure_msl,         'pressure_msl',         1013.0)
    cloud    = pick(req.cloud_cover,          'cloud_cover',          50.0)
    solar    = live_weather['shortwave_radiation'] if live_weather else 100.0
    is_day   = 1 if 6 <= req.hour <= 20 else 0

    temp_sq    = temp ** 2
    heat_index = temp - 0.55 * (1 - humidity / 100) * (temp - 14.5)

    return {
        'latitude':              lat_val,
        'longitude':             lon_val,
        'building_class_enc':    1, # Default Residential
        'cluster_size':          1,
        'temperature_2m':        temp,
        'relative_humidity_2m':  humidity,
        'wind_speed_10m':        wind,
        'pressure_msl':          pressure,
        'cloud_cover':           cloud,
        'shortwave_radiation':   solar,
        'is_day':                is_day,
        'hour_sin':              math.sin(2 * math.pi * req.hour / 24),
        'hour_cos':              math.cos(2 * math.pi * req.hour / 24),
        'month_sin':             math.sin(2 * math.pi * dt.month / 12),
        'month_cos':             math.cos(2 * math.pi * dt.month / 12),
        'dow_sin':               math.sin(2 * math.pi * dow / 7),
        'dow_cos':               math.cos(2 * math.pi * dow / 7),
        'season_sin':            math.sin(2 * math.pi * season / 4),
        'season_cos':            math.cos(2 * math.pi * season / 4),
        'is_weekend':            1 if dow >= 5 else 0,
        'temp_sq':               temp_sq,
        'heat_index':            heat_index,
    }

def build_feature_row(req: PredictRequest, provided_weather: dict | None = None) -> dict:
    dt  = datetime.strptime(req.date, "%Y-%m-%d")
    dow = dt.weekday()
    loc = get_loc_row(req.location_id)
    season = get_season(dt.month)

    # Historical mean demand for this location/hour/dow (proxy for lags)
    mean_d    = get_demand_lk(req.location_id, dow, req.hour)
    log_mean  = math.log1p(mean_d)

    # Weather priority: 1) user input  2) live Open-Meteo  3) historical mean
    any_weather_provided = any(v is not None for v in [
        req.temperature_2m, req.relative_humidity_2m,
        req.wind_speed_10m, req.pressure_msl, req.cloud_cover,
    ])

    loc_meta  = LOCATION_META.get(req.location_id, {'lat': 0.0, 'lon': 0.0, 'climate': 'temperate'})
    lat_val   = req.custom_lat if req.custom_lat is not None else loc_meta['lat']
    lon_val   = req.custom_lon if req.custom_lon is not None else loc_meta['lon']

    live_weather = None
    if provided_weather:
        live_weather = provided_weather
    elif not any_weather_provided:
        live_weather = fetch_live_weather(lat_val, lon_val)

    lk_w = DEMAND_LK[(DEMAND_LK['location_id'] == req.location_id) &
                      (DEMAND_LK['day_of_week'] == dow) &
                      (DEMAND_LK['hour'] == req.hour)]
    lk_w = lk_w.iloc[0] if not lk_w.empty else DEMAND_LK[DEMAND_LK['location_id'] == req.location_id].iloc[0]

    def pick(user_val, live_key, hist_key, default):
        if user_val is not None: return user_val
        if live_weather and live_key in live_weather: return live_weather[live_key]
        return float(lk_w.get(hist_key, default))

    temp     = pick(req.temperature_2m,       'temperature_2m',       'mean_temp',     15.0)
    humidity = pick(req.relative_humidity_2m, 'relative_humidity_2m', 'mean_humidity', 70.0)
    wind     = pick(req.wind_speed_10m,       'wind_speed_10m',       'mean_wind',     10.0)
    pressure = pick(req.pressure_msl,         'pressure_msl',         None,            1013.0)
    cloud    = pick(req.cloud_cover,           'cloud_cover',          None,             50.0)
    solar    = live_weather['shortwave_radiation'] if live_weather else float(lk_w.get('mean_solar', 100.0))

    climate_c = CLIMATE_CODES.get(loc_meta['climate'], 0)
    loc_enc   = LOC_ENC_MAP.get(req.location_id, 0)
    n_bld_n   = float(loc.get('n_buildings_norm', 1.0))

    # Derived weather
    temp_sq    = temp ** 2
    heat_index = temp - 0.55 * (1 - humidity / 100) * (temp - 14.5)
    wind_u     = -wind * math.sin(math.radians(0))
    wind_v     = -wind * math.cos(math.radians(0))
    solar_clr  = solar * (1 if 6 <= req.hour <= 20 else 0)
    is_day     = 1 if 6 <= req.hour <= 20 else 0
    sunshine   = 3600 if is_day else 0

    row = {
        'location_enc':          loc_enc,
        'lat':                   lat_val,
        'lon':                   lon_val,
        'climate':               climate_c,
        'n_buildings_norm':      n_bld_n,
        'year':                  dt.year,
        'month':                 dt.month,
        'day':                   dt.day,
        'hour':                  req.hour,
        'day_of_week':           dow,
        'week_of_year':          int(dt.isocalendar()[1]),
        'quarter':               (dt.month - 1) // 3 + 1,
        'is_weekend':            1 if dow >= 5 else 0,
        'season':                season,
        'hour_sin':              math.sin(2 * math.pi * req.hour / 24),
        'hour_cos':              math.cos(2 * math.pi * req.hour / 24),
        'month_sin':             math.sin(2 * math.pi * dt.month / 12),
        'month_cos':             math.cos(2 * math.pi * dt.month / 12),
        'dow_sin':               math.sin(2 * math.pi * dow / 7),
        'dow_cos':               math.cos(2 * math.pi * dow / 7),
        'season_sin':            math.sin(2 * math.pi * season / 4),
        'season_cos':            math.cos(2 * math.pi * season / 4),
        'temperature_2m':        temp,
        'apparent_temperature':  heat_index,
        'relative_humidity_2m':  humidity,
        'dew_point_2m':          temp - ((100 - humidity) / 5),
        'precipitation':         0.0,
        'rain':                  0.0,
        'snowfall':              0.0,
        'pressure_msl':          pressure,
        'wind_speed_10m':        wind,
        'wind_gusts_10m':        wind * 1.5,
        'cloud_cover':           cloud,
        'shortwave_radiation':   solar,
        'is_day':                float(is_day),
        'sunshine_duration':     float(sunshine),
        'temp_sq':               temp_sq,
        'heat_index':            heat_index,
        'wind_u':                wind_u,
        'wind_v':                wind_v,
        'solar_clear':           solar_clr,
        'lag_1h':                log_mean,
        'lag_2h':                log_mean,
        'lag_24h':               log_mean,
        'lag_168h':              log_mean,
        'roll_mean_24h':         log_mean,
        'roll_std_24h':          log_mean * 0.05,
        'roll_mean_168h':        log_mean,
    }
    return row

# ── Endpoints ──────────────────────────────────────────────────────────────────
@app.get("/api/health")
def health():
    return {"status": "ok", "model": "XGBoost Multi-Location", "locations": METADATA['n_locations']}

@app.get("/api/weather/{location_id}")
def get_live_weather(
    location_id: str,
    lat:  Optional[float] = None,
    lon:  Optional[float] = None,
    date: Optional[str]   = None,
    hour: Optional[int]   = None
):
    """Return weather for a location. If date is provided, returns forecast."""
    loc_meta = LOCATION_META.get(location_id)
    if not loc_meta:
        raise HTTPException(404, f"Unknown location_id: {location_id}")
    
    fetch_lat = lat if lat is not None else loc_meta['lat']
    fetch_lon = lon if lon is not None else loc_meta['lon']

    # If date is provided, try to get forecast from batch data
    if date:
        try:
            # Fetch 14 days of forecast to be safe
            weather_data = fetch_multi_day_weather(fetch_lat, fetch_lon, days=14)
            if weather_data and 'time' in weather_data:
                h = hour if hour is not None else 12
                target_time = f"{date}T{h:02d}:00"
                if target_time in weather_data['time']:
                    idx = weather_data['time'].index(target_time)
                    w = {
                        "temperature_2m":       weather_data['temperature_2m'][idx],
                        "relative_humidity_2m": weather_data['relative_humidity_2m'][idx],
                        "wind_speed_10m":       weather_data['wind_speed_10m'][idx],
                        "pressure_msl":         weather_data['surface_pressure'][idx],
                        "cloud_cover":          weather_data['cloud_cover'][idx],
                        "apparent_temperature": weather_data['temperature_2m'][idx], # Fallback
                        "shortwave_radiation":  weather_data['shortwave_radiation'][idx],
                        "is_day":               1.0 if 6 <= h <= 20 else 0.0
                    }
                else:
                    # Fallback to current weather if target time not found
                    w = fetch_live_weather(fetch_lat, fetch_lon)
            else:
                w = fetch_live_weather(fetch_lat, fetch_lon)
        except Exception:
            w = fetch_live_weather(fetch_lat, fetch_lon)
    else:
        w = fetch_live_weather(fetch_lat, fetch_lon)

    if not w:
        raise HTTPException(503, "Weather service temporarily unavailable")
    loc_row = get_loc_row(location_id)
    return {
        "location_id":         location_id,
        "location":            str(loc_row['location']),
        "lat":                 fetch_lat,
        "lon":                 fetch_lon,
        "temperature_2m":      w["temperature_2m"],
        "relative_humidity_2m":w["relative_humidity_2m"],
        "wind_speed_10m":      w["wind_speed_10m"],
        "pressure_msl":        w["pressure_msl"],
        "cloud_cover":         w["cloud_cover"],
        "apparent_temperature":w["apparent_temperature"],
        "shortwave_radiation":  w["shortwave_radiation"],
        "is_day":               w["is_day"],
        "source":              "open-meteo.com",
        "note":                "Free, no API key required",
    }

@app.get("/api/stats")
def get_stats():
    return {
        "model": {
            "type":           METADATA['model_type'],
            "n_estimators":   int(MODEL.best_iteration) + 1,
            "features":       len(FEATURES),
            "n_locations":    METADATA['n_locations'],
            "train_samples":  METADATA['train_samples'],
            "val_samples":    METADATA['val_samples'],
            "test_samples":   METADATA['test_samples'],
            "split":          METADATA['split'],
            "interval":       METADATA['interval'],
        },
        "performance": {
            "validation":     METADATA['val_metrics'],
            "test":           METADATA['test_metrics'],
            "per_location":   METADATA['per_loc_metrics'],
        },
    }

@app.get("/api/locations")
def get_locations():
    return LOC_LK.to_dict(orient='records')

@app.post("/api/predict", response_model=PredictResponse)
def predict(req: PredictRequest):
    try:
        dt = datetime.strptime(req.date, "%Y-%m-%d")
        season_num = get_season(dt.month)

        if req.mode == "coordinate" and COORD_MODEL is not None:
            row  = build_coordinate_feature_row(req)
            X    = pd.DataFrame([row])[COORD_FEATURES]
            pred_log = float(COORD_MODEL.predict(X)[0])
            pred_kwh = float(np.expm1(pred_log))
            
            rmse  = COORD_METADATA['metrics']['rmse']
            lower = max(0.0, pred_kwh - 1.96 * rmse)
            upper = pred_kwh + 1.96 * rmse
            
            loc_name = f"Custom Pin ({row['latitude']:.4f}, {row['longitude']:.4f})"
            confidence = "Medium (Coordinate)"
        else:
            row  = build_feature_row(req)
            X    = pd.DataFrame([row])[FEATURES]
            pred_log = float(MODEL.predict(X)[0])
            pred_kwh = float(np.expm1(pred_log))

            rmse  = METADATA['test_metrics']['rmse']
            lower = max(0.0, pred_kwh - 1.96 * rmse)
            upper = pred_kwh + 1.96 * rmse

            loc   = get_loc_row(req.location_id)
            loc_name = str(loc['location'])
            confidence = "95% (City Grid)"

        return PredictResponse(
            predicted_demand_kwh = round(pred_kwh, 2),
            prediction_lower     = round(lower, 2),
            prediction_upper     = round(upper, 2),
            location             = loc_name,
            location_id          = req.location_id,
            date                 = req.date,
            hour                 = req.hour,
            season               = SEASON_NAMES[season_num],
            confidence           = confidence,
            input_features       = {k: round(v, 3) if isinstance(v, float) else v
                                    for k, v in list(row.items())[:15]},
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))

@app.get("/api/daily")
def get_daily(
    location: Optional[str] = Query(None),
    start:    Optional[str] = Query(None),
    end:      Optional[str] = Query(None),
    limit:    int           = Query(365, ge=1, le=5000),
):
    df = DAILY_DF.copy()
    if location:
        df = df[df['location'] == location]
    if start:
        df = df[df['date'] >= start]
    if end:
        df = df[df['date'] <= end]
    df = df.tail(limit)
    return df.to_dict(orient='records')

@app.get("/api/monthly")
def get_monthly(
    location:   Optional[str] = Query(None),
    start_year: int = Query(2011, ge=2011, le=2017),
    end_year:   int = Query(2017, ge=2011, le=2017),
):
    df = MONTHLY_DF[(MONTHLY_DF['year'] >= start_year) & (MONTHLY_DF['year'] <= end_year)].copy()
    if location:
        df = df[df['location'] == location]
    return df.to_dict(orient='records')

@app.get("/api/hourly-profile")
def get_hourly_profile(
    location: Optional[str] = Query(None),
    season:   Optional[int] = Query(None, ge=1, le=4),
):
    df = HOURLY_DF.copy()
    if location:
        df = df[df['location'] == location]
    if season is not None:
        df = df[df['season'] == season]
    return df.to_dict(orient='records')

@app.get("/api/feature-importance")
def get_feature_importance():
    fi = METADATA['feature_importance']
    return [{"feature": k, "importance": round(v, 4)} for k, v in fi.items()]

@app.get("/api/forecast")
def get_forecast(
    location_id: str = Query("gcpvj4cmfb0f"),
    days:        int = Query(7, ge=1, le=14),
):
    loc_meta = LOCATION_META.get(location_id, {'lat': 0.0, 'lon': 0.0})
    weather_data = fetch_multi_day_weather(loc_meta['lat'], loc_meta['lon'], days)
    
    today   = date.today()
    results = []
    
    for d in range(1, days + 1):
        target = today + timedelta(days=d)
        target_str = str(target)
        day_results = []
        
        for hour in [6, 9, 12, 15, 18, 21]:
            # Try to find weather in batch data
            provided_w = None
            if weather_data and 'time' in weather_data:
                target_time = f"{target_str}T{hour:02d}:00"
                try:
                    idx = weather_data['time'].index(target_time)
                    provided_w = {
                        "temperature_2m":       weather_data['temperature_2m'][idx],
                        "relative_humidity_2m": weather_data['relative_humidity_2m'][idx],
                        "wind_speed_10m":       weather_data['wind_speed_10m'][idx],
                        "pressure_msl":         weather_data['surface_pressure'][idx],
                        "cloud_cover":          weather_data['cloud_cover'][idx],
                        "shortwave_radiation":  weather_data['shortwave_radiation'][idx],
                    }
                except (ValueError, KeyError, IndexError):
                    pass

            req  = PredictRequest(location_id=location_id, date=target_str, hour=hour)
            row  = build_feature_row(req, provided_weather=provided_w)
            X    = pd.DataFrame([row])[FEATURES]
            pred = float(np.expm1(MODEL.predict(X)[0]))
            day_results.append({"hour": hour, "hour_label": f"{hour:02d}:00", "predicted_kwh": round(pred, 1)})
        
        if not day_results: continue
        
        results.append({
            "date":     target_str,
            "periods":  day_results,
            "peak_kwh": max(r['predicted_kwh'] for r in day_results),
            "avg_kwh":  round(sum(r['predicted_kwh'] for r in day_results) / len(day_results), 1),
        })
    return results

# ── Serve Frontend ──────────────────────────────────────────────────────────────
frontend_dist = os.path.join(os.path.dirname(BASE_DIR), 'frontend', 'dist')
if os.path.isdir(os.path.join(frontend_dist, "assets")):
    app.mount("/assets", StaticFiles(directory=os.path.join(frontend_dist, "assets")), name="assets")

@app.get("/{full_path:path}")
async def serve_frontend(full_path: str):
    file_path = os.path.join(frontend_dist, full_path)
    if os.path.isfile(file_path):
        return FileResponse(file_path)
    index_path = os.path.join(frontend_dist, "index.html")
    if os.path.isfile(index_path):
        return FileResponse(index_path)
    return {"message": "API is running. Frontend build not found."}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
