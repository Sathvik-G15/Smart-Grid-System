"""
Train XGBoost Multi-Location Grid Demand Model
- Loads all location CSVs, resamples to 1H, engineers features
- Per-location chronological 70/15/15 train/val/test split
- Target: log1p(total_demand_kwh)  — scale-invariant across locations
- Saves model, metadata, lookup, and summary artifacts for the API
"""

import os
import sys
import json
import numpy as np
import pandas as pd
import xgboost as xgb
import joblib
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score

sys.path.insert(0, os.path.dirname(__file__))
from feature_engineering import load_all_locations, get_feature_columns

BASE_DIR    = os.path.dirname(os.path.dirname(__file__))
BACKEND_DIR = os.path.join(BASE_DIR, 'backend')
os.makedirs(BACKEND_DIR, exist_ok=True)

# ── 1. Load & Engineer ─────────────────────────────────────────────────────────
df, meta_info = load_all_locations(include_lags=True)

FEATURES = [f for f in get_feature_columns(include_lags=True) if f in df.columns]
TARGET   = 'log_demand'   # log1p(total_demand_kwh)

# ── 2. Per-location chronological 70/15/15 split ───────────────────────────────
print("\nBuilding per-location 70/15/15 train/val/test split...")
train_idx, val_idx, test_idx = [], [], []

for loc_id, grp in df.groupby('location_id'):
    n = len(grp)
    t1 = int(n * 0.70)
    t2 = int(n * 0.85)
    idx = grp.index.tolist()
    train_idx.extend(idx[:t1])
    val_idx.extend(idx[t1:t2])
    test_idx.extend(idx[t2:])
    loc_name = grp['location'].iloc[0]
    print(f"  {loc_name}: train={t1:,} | val={t2-t1:,} | test={n-t2:,}")

X = df[FEATURES]
y = df[TARGET]

X_train, y_train = X.loc[train_idx], y.loc[train_idx]
X_val,   y_val   = X.loc[val_idx],   y.loc[val_idx]
X_test,  y_test  = X.loc[test_idx],  y.loc[test_idx]

print(f"\nTotal -> Train: {len(X_train):,} | Val: {len(X_val):,} | Test: {len(X_test):,}")

# ── 3. Train XGBoost ───────────────────────────────────────────────────────────
print("\nTraining XGBoost model...")
model = xgb.XGBRegressor(
    n_estimators=1000,
    max_depth=8,
    learning_rate=0.05,
    subsample=0.8,
    colsample_bytree=0.8,
    min_child_weight=3,
    gamma=0.1,
    reg_alpha=0.1,
    reg_lambda=1.0,
    random_state=42,
    n_jobs=-1,
    early_stopping_rounds=30,
    eval_metric='rmse',
)

model.fit(
    X_train, y_train,
    eval_set=[(X_val, y_val)],
    verbose=100,
)

# ── 4. Evaluate (in original kWh space after exp1m inverse) ───────────────────
def evaluate(X_s, y_log_true, label=''):
    y_log_pred = model.predict(X_s)
    y_true = np.expm1(y_log_true)
    y_pred = np.expm1(y_log_pred)
    rmse = float(np.sqrt(mean_squared_error(y_true, y_pred)))
    mae  = float(mean_absolute_error(y_true, y_pred))
    r2   = float(r2_score(y_true, y_pred))
    mape = float(np.mean(np.abs((y_true - y_pred) / (np.abs(y_true) + 1e-6))) * 100)
    print(f"  {label}: RMSE={rmse:.1f} kWh | MAE={mae:.1f} kWh | R2={r2:.4f} | MAPE={mape:.2f}%")
    return {'rmse': rmse, 'mae': mae, 'r2': r2, 'mape': mape}

print("\n=== Model Performance (original kWh scale) ===")
val_metrics  = evaluate(X_val,  y_val,  'Validation')
test_metrics = evaluate(X_test, y_test, 'Test')

# ── 5. Per-location test performance ──────────────────────────────────────────
print("\n=== Per-location Test Performance ===")
test_df = df.loc[test_idx].copy()
test_df['y_log_pred'] = model.predict(X_test)
test_df['y_pred']  = np.expm1(test_df['y_log_pred'])
test_df['y_true']  = np.expm1(test_df[TARGET])

per_loc_metrics = {}
for loc_id, grp in test_df.groupby('location_id'):
    loc_name = grp['location'].iloc[0]
    r2   = float(r2_score(grp['y_true'], grp['y_pred']))
    rmse = float(np.sqrt(mean_squared_error(grp['y_true'], grp['y_pred'])))
    mape = float(np.mean(np.abs((grp['y_true'] - grp['y_pred']) / (grp['y_true'].abs() + 1e-6))) * 100)
    print(f"  {loc_name:<35} R2={r2:.4f} | RMSE={rmse:.1f} kWh | MAPE={mape:.2f}%")
    per_loc_metrics[loc_name] = {'r2': r2, 'rmse': rmse, 'mape': mape}

# ── 6. Feature Importance ──────────────────────────────────────────────────────
importance   = dict(zip(FEATURES, model.feature_importances_.tolist()))
top_features = sorted(importance.items(), key=lambda x: x[1], reverse=True)[:20]
print("\nTop 20 features:")
for feat, imp in top_features:
    print(f"  {feat:<35} {imp:.4f}")

# ── 7. Save Model & Metadata ───────────────────────────────────────────────────
model_path = os.path.join(BACKEND_DIR, 'model.pkl')
joblib.dump(model, model_path)
print(f"\nModel saved -> {model_path}")

metadata = {
    'model_type':     'XGBoost Multi-Location Regressor',
    'target':         'log1p(total_demand_kwh)',
    'features':       FEATURES,
    'n_locations':    int(df['location_id'].nunique()),
    'locations':      df.groupby('location_id')['location'].first().to_dict(),
    'val_metrics':    val_metrics,
    'test_metrics':   test_metrics,
    'per_loc_metrics': per_loc_metrics,
    'feature_importance': dict(top_features),
    'train_samples':  int(len(X_train)),
    'val_samples':    int(len(X_val)),
    'test_samples':   int(len(X_test)),
    'best_iteration': int(model.best_iteration),
    'loc_stats':      meta_info['loc_stats'],
    'loc_enc_map':    {k: int(v) for k, v in meta_info['loc_enc_map'].items()},
    'split':          '70/15/15 per-location chronological',
    'interval':       '1H (resampled)',
}

meta_path = os.path.join(BACKEND_DIR, 'model_metadata.json')
with open(meta_path, 'w') as f:
    json.dump(metadata, f, indent=2)
print(f"Metadata saved -> {meta_path}")

# ── 8. Historical Summary for API ─────────────────────────────────────────────
print("Building historical summaries...")

hist = df[['timestamp', 'location_id', 'location', 'year', 'month', 'hour',
           'day_of_week', 'season', 'is_weekend',
           'total_demand_kwh', 'temperature_2m', 'wind_speed_10m',
           'shortwave_radiation', 'relative_humidity_2m']].copy()
hist['date'] = hist['timestamp'].dt.date.astype(str)

# Daily summary per location
daily = hist.groupby(['location', 'date']).agg(
    peak_demand  = ('total_demand_kwh', 'max'),
    min_demand   = ('total_demand_kwh', 'min'),
    avg_demand   = ('total_demand_kwh', 'mean'),
    avg_temp     = ('temperature_2m',   'mean'),
    avg_wind     = ('wind_speed_10m',   'mean'),
    avg_solar    = ('shortwave_radiation', 'mean'),
).reset_index()
daily.to_csv(os.path.join(BACKEND_DIR, 'daily_summary.csv'), index=False)

# Monthly summary per location
monthly = hist.groupby(['location', 'year', 'month']).agg(
    avg_demand  = ('total_demand_kwh', 'mean'),
    peak_demand = ('total_demand_kwh', 'max'),
    avg_temp    = ('temperature_2m',   'mean'),
    avg_wind    = ('wind_speed_10m',   'mean'),
).reset_index()
monthly.to_csv(os.path.join(BACKEND_DIR, 'monthly_summary.csv'), index=False)

# Intraday profile by location + season
intraday = hist.groupby(['location', 'season', 'hour']).agg(
    avg_demand = ('total_demand_kwh', 'mean'),
    std_demand = ('total_demand_kwh', 'std'),
).reset_index()
intraday.to_csv(os.path.join(BACKEND_DIR, 'hourly_profile.csv'), index=False)

# Location lookup (for API predictions)
loc_lookup = df.groupby('location_id').agg(
    location        = ('location', 'first'),
    lat             = ('lat', 'first'),
    lon             = ('lon', 'first'),
    location_enc    = ('location_enc', 'first'),
    n_buildings     = ('n_buildings', 'mean'),
    n_buildings_norm= ('n_buildings_norm', 'first'),
    mean_demand_kwh = ('total_demand_kwh', 'mean'),
).reset_index()
loc_lookup.to_csv(os.path.join(BACKEND_DIR, 'location_lookup.csv'), index=False)

# Demand lookup (historical mean per location+hour+day_of_week for lag fill)
demand_lookup = hist.groupby(['location_id', 'day_of_week', 'hour']).agg(
    mean_demand_kwh = ('total_demand_kwh', 'mean'),
    mean_temp       = ('temperature_2m',   'mean'),
    mean_wind       = ('wind_speed_10m',   'mean'),
    mean_solar      = ('shortwave_radiation', 'mean'),
    mean_humidity   = ('relative_humidity_2m','mean'),
).reset_index()
demand_lookup.to_csv(os.path.join(BACKEND_DIR, 'demand_lookup.csv'), index=False)

print("\n[DONE] Multi-location model training complete!")
print(f"   Val  -> RMSE={val_metrics['rmse']:.1f} kWh | R2={val_metrics['r2']:.4f}")
print(f"   Test -> RMSE={test_metrics['rmse']:.1f} kWh | R2={test_metrics['r2']:.4f}")
print(f"   Locations: {df['location_id'].nunique()} | Features: {len(FEATURES)}")
