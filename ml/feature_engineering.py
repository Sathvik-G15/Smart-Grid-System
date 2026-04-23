"""
Feature Engineering Pipeline — Multi-Location Grid Demand Model
Handles mixed frequencies (30T, 15T, 1H), normalises demand per-location,
and engineers rich datetime + weather features with location identity.
"""

import os
import glob
import numpy as np
import pandas as pd
from sklearn.preprocessing import LabelEncoder
from typing import List, Tuple, Dict

DATASET_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'dataset')

# Metadata for each location (lat/lon/climate zone)
LOCATION_META = {
    'gcpvj4cmfb0f': {'lat': 51.52,  'lon': -0.13,   'climate': 'temperate'},
    'sp1jpqedrbm7': {'lat': 39.39,  'lon': -8.22,   'climate': 'mediterranean'},
    'dqcjr9e0bvw4': {'lat': 38.90,  'lon': -77.04,  'climate': 'humid_subtropical'},
    '9zvxvu65krxz': {'lat': 44.98,  'lon': -93.27,  'climate': 'humid_continental'},
    'gcjszrm15xgd': {'lat': 51.48,  'lon': -3.18,   'climate': 'temperate'},
    '9tbqhgzj9gwc': {'lat': 33.45,  'lon': -112.07, 'climate': 'desert'},
    'djn4hpuvh93f': {'lat': 28.54,  'lon': -81.38,  'climate': 'humid_subtropical'},
    '9v6kpy7zsbvx': {'lat': 30.27,  'lon': -97.74,  'climate': 'humid_subtropical'},
    'dr99e3temvdj': {'lat': 42.44,  'lon': -76.50,  'climate': 'humid_continental'},
    '9q9p3yhbxx8t': {'lat': 37.80,  'lon': -122.27, 'climate': 'mediterranean'},
    'gcpuvr295zcd': {'lat': 51.52,  'lon': -0.13,   'climate': 'temperate'},
    'gcpvj6btgb1d': {'lat': 51.52,  'lon': -0.13,   'climate': 'temperate'},
    'dr4vs1mpgc4v': {'lat': 40.36,  'lon': -74.66,  'climate': 'humid_continental'},
    'u1krw2n6k8f6': {'lat': 52.37,  'lon': 6.70,    'climate': 'temperate'},
    'f244mkkywjsv': {'lat': 45.42,  'lon': -75.69,  'climate': 'humid_continental'},
    'f244jquzyjkb': {'lat': 45.42,  'lon': -75.69,  'climate': 'humid_continental'},
}

CLIMATE_CODES = {c: i for i, c in enumerate(
    ['temperate', 'mediterranean', 'humid_subtropical', 'humid_continental', 'desert']
)}

WEATHER_FEATURES = [
    'temperature_2m', 'apparent_temperature', 'relative_humidity_2m',
    'dew_point_2m', 'precipitation', 'rain', 'snowfall',
    'pressure_msl', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m',
    'cloud_cover', 'shortwave_radiation', 'is_day', 'sunshine_duration',
]


def get_season(month: int) -> int:
    if month in [12, 1, 2]: return 1   # Winter
    elif month in [3, 4, 5]: return 2  # Spring
    elif month in [6, 7, 8]: return 3  # Summer
    else: return 4                      # Autumn


def load_all_locations(include_lags: bool = True) -> Tuple[pd.DataFrame, Dict]:
    """Load all grid demand CSVs, resample to 1H, normalise per-location, engineer features."""
    csv_files = glob.glob(os.path.join(DATASET_DIR, 'grid_demand_*.csv'))
    print(f"Found {len(csv_files)} location CSVs")

    # ── Deduplicate London_UK_1H (multiple small batches saved same filename) ──
    # We'll track which location_ids we've already loaded
    seen_loc_ids = set()
    frames = []

    for fpath in sorted(csv_files):
        df = pd.read_csv(fpath, parse_dates=['timestamp'])
        loc_id = df['location_id'].iloc[0]

        # Skip if we already have this exact location+freq (duplicate London_1H)
        freq_key = f"{loc_id}_{df['freq'].iloc[0]}"
        if freq_key in seen_loc_ids:
            print(f"  [SKIP duplicate] {os.path.basename(fpath)}")
            continue
        seen_loc_ids.add(freq_key)

        print(f"  Loading {os.path.basename(fpath)}: {len(df):,} rows | "
              f"freq={df['freq'].iloc[0]} | loc={df['location'].iloc[0]}")

        # Resample 30T / 15T -> 1H (sum kWh, mean weather)
        orig_freq = df['freq'].iloc[0]
        if orig_freq in ['30T', '15T']:
            # Set timestamp as index, aggregate to hourly
            df = df.set_index('timestamp')
            demand_hourly = df[['total_demand_kwh', 'n_buildings', 'mean_demand_kwh']].resample('1h').agg({
                'total_demand_kwh': 'sum',
                'n_buildings':      'mean',
                'mean_demand_kwh':  'mean',
            })
            weather_hourly = df[WEATHER_FEATURES].resample('1h').mean()
            df_h = pd.concat([demand_hourly, weather_hourly], axis=1).reset_index()
            df_h['location_id'] = loc_id
            df_h['location']    = df['location'].iloc[0]
            df_h['freq']        = orig_freq
            df = df_h
        else:
            df = df.reset_index(drop=True)

        frames.append(df)

    combined = pd.concat(frames, ignore_index=True)
    print(f"\nCombined shape (before feature eng): {combined.shape}")

    # ── Per-location demand normalisation (log1p for scale-invariance) ──────
    combined['log_demand'] = np.log1p(combined['total_demand_kwh'])

    # Also store per-location mean/std for inverse transform at inference
    loc_stats = (
        combined.groupby('location_id')['total_demand_kwh']
        .agg(['mean', 'std', 'median'])
        .rename(columns={'mean': 'demand_mean', 'std': 'demand_std', 'median': 'demand_median'})
        .to_dict(orient='index')
    )

    # ── Sort by location + timestamp ────────────────────────────────────────
    combined = combined.sort_values(['location_id', 'timestamp']).reset_index(drop=True)

    # ── Label-encode location ────────────────────────────────────────────────
    le = LabelEncoder()
    combined['location_enc'] = le.fit_transform(combined['location_id'].astype(str))
    loc_enc_map = dict(zip(le.classes_, le.transform(le.classes_)))

    # ── Add location metadata (lat/lon/climate) ──────────────────────────────
    combined['lat']     = combined['location_id'].map(lambda x: LOCATION_META.get(x, {}).get('lat', 0.0))
    combined['lon']     = combined['location_id'].map(lambda x: LOCATION_META.get(x, {}).get('lon', 0.0))
    combined['climate'] = combined['location_id'].map(
        lambda x: CLIMATE_CODES.get(LOCATION_META.get(x, {}).get('climate', 'temperate'), 0)
    )
    combined['n_buildings_norm'] = combined['n_buildings'] / combined.groupby('location_id')['n_buildings'].transform('max')

    # ── Datetime features ────────────────────────────────────────────────────
    dt = combined['timestamp']
    combined['year']        = dt.dt.year
    combined['month']       = dt.dt.month
    combined['day']         = dt.dt.day
    combined['hour']        = dt.dt.hour
    combined['day_of_week'] = dt.dt.dayofweek
    combined['week_of_year']= dt.dt.isocalendar().week.astype(int)
    combined['quarter']     = dt.dt.quarter
    combined['is_weekend']  = (combined['day_of_week'] >= 5).astype(int)
    combined['season']      = combined['month'].apply(get_season)

    # ── Cyclical encodings ───────────────────────────────────────────────────
    combined['hour_sin']   = np.sin(2 * np.pi * combined['hour'] / 24)
    combined['hour_cos']   = np.cos(2 * np.pi * combined['hour'] / 24)
    combined['month_sin']  = np.sin(2 * np.pi * combined['month'] / 12)
    combined['month_cos']  = np.cos(2 * np.pi * combined['month'] / 12)
    combined['dow_sin']    = np.sin(2 * np.pi * combined['day_of_week'] / 7)
    combined['dow_cos']    = np.cos(2 * np.pi * combined['day_of_week'] / 7)
    combined['season_sin'] = np.sin(2 * np.pi * combined['season'] / 4)
    combined['season_cos'] = np.cos(2 * np.pi * combined['season'] / 4)

    # ── Derived weather features ─────────────────────────────────────────────
    combined['temp_sq']      = combined['temperature_2m'] ** 2
    combined['heat_index']   = (combined['temperature_2m']
                                - 0.55 * (1 - combined['relative_humidity_2m'] / 100)
                                * (combined['temperature_2m'] - 14.5))
    combined['wind_u']       = -combined['wind_speed_10m'] * np.sin(np.deg2rad(combined['wind_direction_10m']))
    combined['wind_v']       = -combined['wind_speed_10m'] * np.cos(np.deg2rad(combined['wind_direction_10m']))
    combined['solar_clear']  = combined['shortwave_radiation'] * combined['is_day']

    if include_lags:
        print("  Computing per-location lag/rolling features...")
        # Must compute lags WITHIN each location group (sorted by timestamp)
        def add_lags(grp):
            s = grp['log_demand']
            grp['lag_1h']    = s.shift(1)
            grp['lag_2h']    = s.shift(2)
            grp['lag_24h']   = s.shift(24)
            grp['lag_168h']  = s.shift(168)   # 1 week
            shifted = s.shift(1)
            grp['roll_mean_24h']  = shifted.rolling(24).mean()
            grp['roll_std_24h']   = shifted.rolling(24).std()
            grp['roll_mean_168h'] = shifted.rolling(168).mean()
            return grp

        combined = combined.groupby('location_id', group_keys=False).apply(add_lags)
        before = len(combined)
        combined = combined.dropna()
        print(f"  Dropped {before - len(combined):,} rows (lag NaNs) -> {len(combined):,} remain")

    print(f"Final engineered shape: {combined.shape}")
    return combined, {'loc_stats': loc_stats, 'loc_enc_map': loc_enc_map}


def get_feature_columns(include_lags: bool = True) -> List[str]:
    base = [
        # Location identity
        'location_enc', 'lat', 'lon', 'climate', 'n_buildings_norm',
        # Datetime
        'year', 'month', 'day', 'hour', 'day_of_week', 'week_of_year',
        'quarter', 'is_weekend', 'season',
        # Cyclical
        'hour_sin', 'hour_cos', 'month_sin', 'month_cos',
        'dow_sin', 'dow_cos', 'season_sin', 'season_cos',
        # Weather
        'temperature_2m', 'apparent_temperature', 'relative_humidity_2m',
        'dew_point_2m', 'precipitation', 'rain', 'snowfall',
        'pressure_msl', 'wind_speed_10m', 'wind_gusts_10m',
        'cloud_cover', 'shortwave_radiation', 'is_day', 'sunshine_duration',
        # Derived weather
        'temp_sq', 'heat_index', 'wind_u', 'wind_v', 'solar_clear',
    ]
    lag_feats = [
        'lag_1h', 'lag_2h', 'lag_24h', 'lag_168h',
        'roll_mean_24h', 'roll_std_24h', 'roll_mean_168h',
    ]
    return base + (lag_feats if include_lags else [])
