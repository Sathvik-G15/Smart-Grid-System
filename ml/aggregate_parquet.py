"""
Aggregate parquet demand data to grid-level by location.
Processes one location at a time to stay memory-efficient.
"""
import os
import pandas as pd
import numpy as np

BASE_DIR    = os.path.dirname(os.path.dirname(__file__))
DATASET_DIR = os.path.join(BASE_DIR, 'dataset')

DEMAND_PATH  = os.path.join(DATASET_DIR, 'demand.parquet')
META_PATH    = os.path.join(DATASET_DIR, 'metadata.parquet')
WEATHER_PATH = os.path.join(DATASET_DIR, 'weather.parquet')

# ── 1. Load Metadata ───────────────────────────────────────────────────────────
print("Step 1: Loading metadata...")
meta = pd.read_parquet(META_PATH)
meta['unique_id'] = meta['unique_id'].astype(str)

# Only keep rows that have actual buildings (non-zero count per loc+freq combo)
# Build: location_id -> list of unique_ids  (only from the correct freq)
loc_map = (
    meta.dropna(subset=['unique_id'])
    .groupby(['location_id', 'location', 'freq'], observed=True)['unique_id']
    .apply(list)
    .reset_index()
)
loc_map['n_buildings'] = loc_map['unique_id'].apply(lambda x: len(x) if isinstance(x, list) else 0)
loc_map = loc_map[loc_map['n_buildings'] > 0].sort_values('n_buildings', ascending=False)
print("Locations with buildings:")
print(loc_map[['location', 'location_id', 'freq', 'n_buildings']].to_string(index=False))

# ── 2. Load weather once (hourly, all locations) ───────────────────────────────
print("\nStep 2: Loading weather...")
weather = pd.read_parquet(WEATHER_PATH)
weather['timestamp'] = pd.to_datetime(weather['timestamp'])
# Keep only useful weather columns
WEATHER_COLS = [
    'location_id', 'timestamp',
    'temperature_2m', 'apparent_temperature', 'relative_humidity_2m',
    'dew_point_2m', 'precipitation', 'rain', 'snowfall',
    'pressure_msl', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m',
    'cloud_cover', 'shortwave_radiation', 'is_day', 'sunshine_duration',
]
weather = weather[WEATHER_COLS]
print(f"  Weather shape: {weather.shape}")

# ── 3. Process each location independently ─────────────────────────────────────
print("\nStep 3: Processing each location...")
summaries = []

for _, row in loc_map.iterrows():
    loc_id   = row['location_id']
    loc_name = row['location']
    freq     = row['freq']
    uid_list = row['unique_id']

    print(f"\n  [{loc_name}] {freq} | {len(uid_list)} buildings")

    # Load demand for this location's buildings only
    demand_loc = pd.read_parquet(
        DEMAND_PATH,
        filters=[('unique_id', 'in', uid_list)]
    )
    demand_loc['unique_id'] = demand_loc['unique_id'].astype(str)
    demand_loc = demand_loc[demand_loc['unique_id'].isin(uid_list)]
    print(f"    Rows loaded: {len(demand_loc):,}")

    # Aggregate: sum demand across all buildings per timestamp
    agg = (
        demand_loc.groupby('timestamp')
        .agg(
            total_demand_kwh = ('y', 'sum'),
            n_buildings      = ('y', 'count'),
            mean_demand_kwh  = ('y', 'mean'),
        )
        .reset_index()
    )
    agg['location_id'] = loc_id
    agg['location']    = loc_name
    agg['freq']        = freq

    # Join with weather (floor to nearest hour)
    agg['timestamp_h'] = agg['timestamp'].dt.floor('h')
    loc_weather = weather[weather['location_id'] == loc_id].copy()
    loc_weather = loc_weather.rename(columns={'timestamp': 'timestamp_h'})

    merged = agg.merge(loc_weather.drop(columns=['location_id']),
                       on='timestamp_h', how='left')
    merged = merged.drop(columns=['timestamp_h'])

    weather_null_pct = merged['temperature_2m'].isnull().mean() * 100
    print(f"    After join: {len(merged):,} rows | weather null: {weather_null_pct:.1f}%")
    print(f"    Demand mean: {merged['total_demand_kwh'].mean():.2f} kWh | max: {merged['total_demand_kwh'].max():.2f} kWh")
    print(f"    Date range: {merged['timestamp'].min()} -> {merged['timestamp'].max()}")

    # Save
    safe_name = loc_name.replace(', ', '_').replace(' ', '_').replace('/', '_')
    out_name  = f"grid_demand_{safe_name}_{freq}.csv"
    out_path  = os.path.join(DATASET_DIR, out_name)
    merged.sort_values('timestamp').to_csv(out_path, index=False)
    print(f"    Saved -> {out_name}")

    summaries.append({
        'location':      loc_name,
        'location_id':   loc_id,
        'freq':          freq,
        'n_buildings':   len(uid_list),
        'rows':          len(merged),
        'date_min':      str(merged['timestamp'].min()),
        'date_max':      str(merged['timestamp'].max()),
        'demand_mean':   round(merged['total_demand_kwh'].mean(), 2),
        'demand_max':    round(merged['total_demand_kwh'].max(), 2),
        'weather_null%': round(weather_null_pct, 1),
        'file':          out_name,
    })

# ── 4. Print final summary ─────────────────────────────────────────────────────
print("\n" + "=" * 80)
print("[DONE] All locations aggregated.")
print("=" * 80)
summary_df = pd.DataFrame(summaries)
print(summary_df[[
    'location', 'freq', 'n_buildings', 'rows',
    'date_min', 'date_max', 'demand_mean', 'demand_max', 'weather_null%', 'file'
]].to_string(index=False))
