import os
import math
import json
import warnings
import pyarrow.parquet as pq
import pandas as pd
import numpy as np
import xgboost as xgb
from sklearn.model_selection import train_test_split
from sklearn.metrics import r2_score, mean_absolute_error, root_mean_squared_error

warnings.filterwarnings('ignore')

DATA_DIR = r"e:\Sathvik\programming\Electricity Demand\dataset"
DEMAND_PATH = os.path.join(DATA_DIR, "demand.parquet")
META_PATH = os.path.join(DATA_DIR, "metadata.parquet")
WEATHER_PATH = os.path.join(DATA_DIR, "weather.parquet")

def get_season(month: int) -> int:
    if month in [12, 1, 2]: return 1
    elif month in [3, 4, 5]: return 2
    elif month in [6, 7, 8]: return 3
    else: return 4

def prepare_data(frac=0.01):
    print("Loading metadata...")
    meta = pd.read_parquet(META_PATH, columns=['unique_id', 'location_id', 'latitude', 'longitude', 'building_class', 'cluster_size'])
    
    # Fill any nulls in building class
    meta['building_class'] = meta['building_class'].astype(str)
    meta['building_class'] = meta['building_class'].replace('nan', 'Unknown')
    meta['building_class'] = meta['building_class'].fillna('Unknown')
    # Label encode building class for XGBoost
    building_classes = sorted(meta['building_class'].unique())
    bclass_map = {c: i for i, c in enumerate(building_classes)}
    meta['building_class_enc'] = meta['building_class'].map(bclass_map)
    
    print("Loading weather...")
    # Read weather data with relevant columns
    w_cols = ['location_id', 'timestamp', 'temperature_2m', 'relative_humidity_2m', 
              'wind_speed_10m', 'pressure_msl', 'cloud_cover', 'shortwave_radiation', 'is_day']
    weather = pd.read_parquet(WEATHER_PATH, columns=w_cols)
    # Forward fill weather per location
    weather = weather.sort_values(['location_id', 'timestamp'])
    
    # Simple ffill without losing location_id
    weather[w_cols[2:]] = weather.groupby('location_id')[w_cols[2:]].ffill().bfill()
    
    print(f"Sampling {frac*100}% of raw demand data from chunks...")
    parquet_file = pq.ParquetFile(DEMAND_PATH)
    sampled_dfs = []
    
    for i in range(parquet_file.num_row_groups):
        df_chunk = parquet_file.read_row_group(i, columns=['unique_id', 'timestamp', 'y']).to_pandas()
        if not df_chunk.empty:
            sampled = df_chunk.sample(frac=frac, random_state=42)
            sampled_dfs.append(sampled)
        if i % 20 == 0:
            print(f"  Processed {i}/{parquet_file.num_row_groups} row groups...")
            
    df = pd.concat(sampled_dfs, ignore_index=True)
    print(f"Sampled total {len(df)} rows.")
    
    print("Merging data...")
    # Drop rows where y is NaN or strictly < 0
    df = df.dropna(subset=['y'])
    df = df[df['y'] >= 0]
    
    # Ensure timestamp is matching
    df['timestamp'] = pd.to_datetime(df['timestamp']).dt.floor('h')
    weather['timestamp'] = pd.to_datetime(weather['timestamp']).dt.floor('h')
    
    # Merge metadata
    df = df.merge(meta, on='unique_id', how='left')
    
    # Merge weather
    df = df.merge(weather, on=['location_id', 'timestamp'], how='left')
    
    # Fill missing weather with dataset medians (rare but happens)
    for c in ['temperature_2m', 'relative_humidity_2m', 'wind_speed_10m', 'pressure_msl', 'cloud_cover', 'shortwave_radiation', 'is_day']:
        df[c] = df[c].fillna(df[c].median())

    print("Engineering cyclical features...")
    df['hour'] = df['timestamp'].dt.hour
    df['month'] = df['timestamp'].dt.month
    df['dow'] = df['timestamp'].dt.dayofweek
    df['season'] = df['month'].apply(get_season)
    df['is_weekend'] = (df['dow'] >= 5).astype(int)

    df['hour_sin']   = np.sin(2 * np.pi * df['hour'] / 24)
    df['hour_cos']   = np.sin(2 * np.pi * df['hour'] / 24)
    df['month_sin']  = np.sin(2 * np.pi * df['month'] / 12)
    df['month_cos']  = np.cos(2 * np.pi * df['month'] / 12)
    df['dow_sin']    = np.sin(2 * np.pi * df['dow'] / 7)
    df['dow_cos']    = np.cos(2 * np.pi * df['dow'] / 7)
    df['season_sin'] = np.sin(2 * np.pi * df['season'] / 4)
    df['season_cos'] = np.cos(2 * np.pi * df['season'] / 4)
    
    # Derived weather
    df['temp_sq'] = df['temperature_2m'] ** 2
    df['heat_index'] = df['temperature_2m'] - 0.55 * (1 - df['relative_humidity_2m']/100) * (df['temperature_2m'] - 14.5)
    
    # Normalise Target: Log transform
    df['log_y'] = np.log1p(df['y'])

    features = [
        'latitude', 'longitude', 'building_class_enc', 'cluster_size',
        'temperature_2m', 'relative_humidity_2m', 'wind_speed_10m',
        'pressure_msl', 'cloud_cover', 'shortwave_radiation', 'is_day',
        'hour_sin', 'hour_cos', 'month_sin', 'month_cos', 
        'dow_sin', 'dow_cos', 'season_sin', 'season_cos', 'is_weekend',
        'temp_sq', 'heat_index'
    ]
    
    df = df.dropna(subset=features + ['log_y'])
    
    return df, features, bclass_map

if __name__ == "__main__":
    df, FEATURES, bclass_map = prepare_data(frac=0.015)  # 1.5% gives ~3.5M rows

    X = df[FEATURES]
    y = df['log_y']

    print("Splitting data...")
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.1, random_state=42)

    print("Training Coordinate XGBoost Model...")
    model = xgb.XGBRegressor(
        n_estimators=150,
        max_depth=9,
        learning_rate=0.1,
        subsample=0.8,
        colsample_bytree=0.8,
        tree_method='hist',
        n_jobs=-1,
        random_state=42
    )

    model.fit(
        X_train, y_train,
        eval_set=[(X_test, y_test)],
        verbose=10
    )

    print("Evaluating Model...")
    y_pred_log = model.predict(X_test)
    y_pred = np.expm1(y_pred_log)
    y_true = np.expm1(y_test)

    r2 = r2_score(y_true, y_pred)
    mae = mean_absolute_error(y_true, y_pred)
    rmse = root_mean_squared_error(y_true, y_pred)

    print(f"R2 Score: {r2:.4f}")
    print(f"MAE:      {mae:.2f} kWh")
    print(f"RMSE:     {rmse:.2f} kWh")

    print("Saving model artifacts...")
    backend_dir = r"e:\Sathvik\programming\Electricity Demand\backend"
    model_path = os.path.join(backend_dir, "coordinate_model.pkl")
    meta_path = os.path.join(backend_dir, "coordinate_metadata.json")

    import joblib
    joblib.dump(model, model_path)

    metadata = {
        "model_type": "XGBoost Regressor (Coordinate-level)",
        "features": FEATURES,
        "metrics": {
            "r2": float(r2),
            "mae": float(mae),
            "rmse": float(rmse)
        },
        "building_class_map": bclass_map,
        "n_samples": len(df)
    }

    with open(meta_path, "w") as f:
        json.dump(metadata, f, indent=2)

    print("Coordinate model training complete!")
