#!/usr/bin/env python3
"""
Physics-informed synthetic generator for Thermo Hybrid (PLAN §4 Module 2 / §7)
Base physics: predicted = base_load * (1 + k1*(T_inside - T_outside) + k2*wind) + k3*pressure_delta + noise
Residual model learns (actual - physics) from features [temp_outside, wind, pressure, crew, dg_load]
Generates weather_fuel_history.csv across 3 stations, 365 days each.
"""
import csv, random, math, pathlib, numpy as np

random.seed(42); np.random.seed(42)
T_INSIDE = 18.0
BASE_LOAD = 110.0  # L/day at calm 0C
K1, K2, K3 = 0.012, 0.018, 0.08
OUT = pathlib.Path(__file__).parent / "weather_fuel_history.csv"
OUT.parent.mkdir(parents=True, exist_ok=True)

stations = [
    ("ST-BHARATI", 24),
    ("ST-MAITRI", 25),
    ("ST-HIMADRI", 8),
]

with open(OUT, "w", newline="") as f:
    w=csv.writer(f)
    w.writerow(["station_id","day","temp_outside","wind_speed","pressure","crew_count","dg_load","physics_pred","actual","residual"])
    for sid, crew in stations:
        for day in range(365):
            # seasonal temp: Bharati -15 to -35, Himadri -5 to -25 with noise
            base_temp = -25 if sid!="ST-HIMADRI" else -15
            temp = base_temp + 8*math.sin(2*math.pi*day/365) + random.gauss(0,4)
            wind = max(0, random.gauss(6, 4) + (8 if 150<day<250 else 0))  # blizzard season
            pressure = random.gauss(980, 12)
            dg_load = random.uniform(0.6, 0.95)
            pressure_delta = (1013 - pressure)/1013
            physics = BASE_LOAD * (1 + K1*(T_INSIDE - temp) + K2*wind) + K3*pressure_delta*BASE_LOAD
            # residual correlated with dg_load and crew
            residual = 5*dg_load + 0.3*crew + random.gauss(0, 6)
            actual = physics + residual
            w.writerow([sid, day, round(temp,2), round(wind,2), round(pressure,2), crew, round(dg_load,3), round(physics,2), round(actual,2), round(residual,2)])

print(f"wrote {OUT} {sum(1 for _ in open(OUT))-1} rows")
# stats
import pandas as pd
try:
    df=pd.read_csv(OUT)
    print(df.describe().to_string())
except: pass
