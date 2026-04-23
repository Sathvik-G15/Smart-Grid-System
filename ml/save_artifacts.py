"""
Save post-training artifacts: metadata, lookup, daily/monthly/hourly summaries.
Run this if train_model.py crashed after saving the model.
"""
import os, sys, json
import pandas as pd
import joblib

sys.path.insert(0, os.path.dirname(__file__))
from feature_engineering import load_and_engineer, get_feature_columns, build_prediction_lookup, get_season

BASE_DIR    = os.path.dirname(os.path.dirname(__file__))
BACKEND_DIR = os.path.join(BASE_DIR, 'backend')
DATASET_PATH= os.path.join(BASE_DIR, 'dataset', 'historic_demand_2009_2024.csv')

print("Loading data...")
df = load_and_engineer(DATASET_PATH, include_lags=True)
FEATURES = get_feature_columns(include_lags=True)

train_mask = df['year'] <= 2022
val_mask   = df['year'] == 2023
test_mask  = df['year'] == 2024

model = joblib.load(os.path.join(BACKEND_DIR, 'model.pkl'))

import numpy as np
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score

y_val  = df[val_mask]['nd']
y_test = df[test_mask]['nd']
y_pred_val  = model.predict(df[val_mask][FEATURES])
y_pred_test = model.predict(df[test_mask][FEATURES])

def mets(yt, yp):
    rmse = float(np.sqrt(mean_squared_error(yt, yp)))
    mae  = float(mean_absolute_error(yt, yp))
    r2   = float(r2_score(yt, yp))
    mape = float(np.mean(np.abs((yt-yp)/(yt+1)))*100)
    return {'rmse':rmse,'mae':mae,'r2':r2,'mape':mape}

val_metrics  = mets(y_val,  y_pred_val)
test_metrics = mets(y_test, y_pred_test)

importance = dict(zip(FEATURES, model.feature_importances_.tolist()))
top_features = sorted(importance.items(), key=lambda x: x[1], reverse=True)[:20]

metadata = {
    'features': FEATURES,
    'target': 'nd',
    'val_metrics':  val_metrics,
    'test_metrics': test_metrics,
    'feature_importance': dict(top_features),
    'train_samples': int(train_mask.sum()),
    'val_samples':   int(val_mask.sum()),
    'test_samples':  int(test_mask.sum()),
    'best_iteration': int(model.best_iteration),
    'date_range': {'train':'2009-2022','val':'2023','test':'2024'}
}
with open(os.path.join(BACKEND_DIR,'model_metadata.json'),'w') as f:
    json.dump(metadata,f,indent=2)
print("Saved model_metadata.json")

print("Building lookup table...")
lookup = build_prediction_lookup(df)
lookup.to_csv(os.path.join(BACKEND_DIR,'demand_lookup.csv'),index=False)
print("Saved demand_lookup.csv")

print("Building historical summaries...")
hist = df[['settlement_date','year','month','day_of_week','settlement_period',
           'nd','tsd','embedded_wind_generation','embedded_solar_generation',
           'renewable_generation','renewable_penetration','season','is_holiday']].copy()

daily = hist.groupby('settlement_date').agg(
    peak_demand=('nd','max'), min_demand=('nd','min'), avg_demand=('nd','mean'),
    total_wind=('embedded_wind_generation','mean'),
    total_solar=('embedded_solar_generation','mean'),
    renewable_pct=('renewable_penetration','mean'),
).reset_index()
daily['settlement_date'] = daily['settlement_date'].astype(str)
daily.to_csv(os.path.join(BACKEND_DIR,'daily_summary.csv'),index=False)
print("Saved daily_summary.csv")

monthly = hist.groupby(['year','month']).agg(
    avg_demand=('nd','mean'), peak_demand=('nd','max'),
    avg_wind=('embedded_wind_generation','mean'),
    avg_solar=('embedded_solar_generation','mean'),
    renewable_pct=('renewable_penetration','mean'),
).reset_index()
monthly.to_csv(os.path.join(BACKEND_DIR,'monthly_summary.csv'),index=False)
print("Saved monthly_summary.csv")

hourly = hist.groupby(['season','settlement_period']).agg(
    avg_demand=('nd','mean'), std_demand=('nd','std'),
).reset_index()
hourly.to_csv(os.path.join(BACKEND_DIR,'hourly_profile.csv'),index=False)
print("Saved hourly_profile.csv")

print("\nAll done! R2=", round(test_metrics['r2'],4), " RMSE=", round(test_metrics['rmse'],1))
