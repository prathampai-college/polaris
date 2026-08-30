#!/usr/bin/env python3
"""Phase 2.3 — Per-station physics calibration.

Fits K1,K2,K3 from last 30d live telemetry + consumption deltas via lstsq:
  total = BASE*(1 + K1*(T_INSIDE-temp) + K2*wind) + K3*pd*BASE
where pd=(1013-pressure)/1013, T_INSIDE/BASE fixed per station row, K coeffs updated.

Usage:
  python scripts/calibrate_physics.py [--station ST-BHARATI] [--dry-run]
  DATABASE_URL=postgresql://... python scripts/calibrate_physics.py   # PG path
  python scripts/calibrate_physics.py   # SQLite fallback hq/app/hq.db
"""
import os, sys, pathlib, argparse, datetime

STATIONS = ["ST-BHARATI", "ST-MAITRI", "ST-HIMADRI"]

def get_conn():
    db_url = os.getenv("DATABASE_URL", "")
    if db_url.startswith("postgresql"):
        import psycopg
        return psycopg.connect(db_url), True
    else:
        import sqlite3
        p = pathlib.Path(__file__).parent.parent / "hq" / "app" / "hq.db"
        if not p.exists():
            p = pathlib.Path("hq/app/hq.db")
        conn = sqlite3.connect(str(p))
        conn.row_factory = sqlite3.Row
        return conn, False

def fetch_daily(db, is_pg, station_id):
    """Return list of {day, avg_temp, avg_wind, avg_pressure, actual_burn} for last 30d."""
    # telemetry daily avg
    # transactions daily burn: actual_burn = -SUM(qty_delta) where type IN ('CONSUME','OUT')
    # Use 30d window
    if is_pg:
        # Use psycopg cursor
        with db.cursor() as cur:
            # Check if transactions table has data; if not, use synthetic fallback (no calibration)
            cur.execute("""
                SELECT SUBSTR(ts,1,10) as day, AVG(temp_outside) as avg_temp, AVG(wind_speed) as avg_wind, AVG(pressure) as avg_pressure
                FROM telemetry WHERE station_id=%s AND ts >= NOW() - INTERVAL '30 days'
                GROUP BY SUBSTR(ts,1,10) ORDER BY day
            """, (station_id,))
            tele_rows = cur.fetchall()
            # Try to get daily burn from transactions joined to assets-> crates-> containers? Simplify: global burn not station-scoped; approximate per station not available -> use transactions generic
            cur.execute("""
                SELECT SUBSTR(ts,1,10) as day, -SUM(qty_delta) as actual_burn
                FROM transactions WHERE type IN ('CONSUME','OUT') AND ts >= NOW() - INTERVAL '30 days'
                GROUP BY SUBSTR(ts,1,10) ORDER BY day
            """)
            burn_rows = {r[0]: float(r[1]) for r in cur.fetchall()}
            result = []
            for r in tele_rows:
                day = r[0]
                if day in burn_rows and burn_rows[day] is not None and burn_rows[day] > 0:
                    result.append({"day": day, "avg_temp": float(r[1]), "avg_wind": float(r[2]), "avg_pressure": float(r[3]), "actual_burn": burn_rows[day]})
            return result
    else:
        # SQLite: ts is ISO string, use date() truncation via SUBSTR
        cur = db.execute("""
            SELECT SUBSTR(ts,1,10) as day, AVG(temp_outside) as avg_temp, AVG(wind_speed) as avg_wind, AVG(pressure) as avg_pressure
            FROM telemetry WHERE station_id=? AND ts >= datetime('now','-30 days')
            GROUP BY SUBSTR(ts,1,10) ORDER BY day
        """, (station_id,))
        tele_rows = cur.fetchall()
        cur2 = db.execute("""
            SELECT SUBSTR(ts,1,10) as day, -SUM(qty_delta) as actual_burn
            FROM transactions WHERE type IN ('CONSUME','OUT') AND ts >= datetime('now','-30 days')
            GROUP BY SUBSTR(ts,1,10) ORDER BY day
        """)
        burn_map = {r["day"]: float(r["actual_burn"]) for r in cur2.fetchall() if r["actual_burn"] is not None}
        result = []
        for r in tele_rows:
            day = r["day"]
            if day in burn_map and burn_map[day] > 0:
                result.append({"day": day, "avg_temp": float(r["avg_temp"]), "avg_wind": float(r["avg_wind"]), "avg_pressure": float(r["avg_pressure"]), "actual_burn": burn_map[day]})
        return result

def calibrate_station(db, is_pg, station_id, dry_run=False):
    import numpy as np
    # get current physics
    if is_pg:
        with db.cursor() as cur:
            cur.execute("SELECT T_INSIDE, BASE, K1, K2, K3 FROM physics_params WHERE station_id=%s", (station_id,))
            row = cur.fetchone()
            if not row:
                print(f"[{station_id}] no physics_params row, skipping")
                return None
            T_INSIDE, BASE, K1_old, K2_old, K3_old = map(float, row)
    else:
        cur = db.execute("SELECT T_INSIDE, BASE, K1, K2, K3 FROM physics_params WHERE station_id=?", (station_id,))
        row = cur.fetchone()
        if not row:
            print(f"[{station_id}] no physics_params row, skipping")
            return None
        T_INSIDE, BASE, K1_old, K2_old, K3_old = float(row["T_INSIDE"]), float(row["BASE"]), float(row["K1"]), float(row["K2"]), float(row["K3"])
    data = fetch_daily(db, is_pg, station_id)
    if len(data) < 5:
        print(f"[{station_id}] insufficient data ({len(data)} days) - need >=5, keeping old K1={K1_old} K2={K2_old} K3={K3_old}")
        return {"station_id": station_id, "K1": K1_old, "K2": K2_old, "K3": K3_old, "fitted": False, "n": len(data)}
    # Build X, y
    # y = actual - BASE
    # X = [BASE*(T_INSIDE-temp), BASE*wind, BASE*pd]
    y = []
    X = []
    for d in data:
        pd = (1013 - d["avg_pressure"]) / 1013
        y.append(d["actual_burn"] - BASE)
        X.append([BASE * (T_INSIDE - d["avg_temp"]), BASE * d["avg_wind"], BASE * pd])
    y = np.array(y, dtype=float)
    X = np.array(X, dtype=float)
    # lstsq
    try:
        coeffs, residuals, rank, s = np.linalg.lstsq(X, y, rcond=None)
        K1_new, K2_new, K3_new = map(float, coeffs)
    except Exception as e:
        print(f"[{station_id}] lstsq failed: {e}, keeping old")
        return None
    # Clamp to reasonable ranges to avoid divergence
    K1_new = max(0.001, min(0.05, K1_new))
    K2_new = max(0.001, min(0.05, K2_new))
    K3_new = max(0.0, min(0.2, K3_new))
    print(f"[{station_id}] fit n={len(data)} old K1={K1_old:.5f} K2={K2_old:.5f} K3={K3_old:.5f} -> new K1={K1_new:.5f} K2={K2_new:.5f} K3={K3_new:.5f} residual={residuals[0] if len(residuals) else 0:.2f}")
    if not dry_run:
        if is_pg:
            with db.cursor() as cur:
                cur.execute("UPDATE physics_params SET K1=%s, K2=%s, K3=%s WHERE station_id=%s", (K1_new, K2_new, K3_new, station_id))
            db.commit()
        else:
            db.execute("UPDATE physics_params SET K1=?, K2=?, K3=? WHERE station_id=?", (K1_new, K2_new, K3_new, station_id))
            db.commit()
        print(f"[{station_id}] updated DB")
    else:
        print(f"[{station_id}] dry-run, not updating")
    return {"station_id": station_id, "K1": K1_new, "K2": K2_new, "K3": K3_new, "fitted": True, "n": len(data)}

def main():
    parser = argparse.ArgumentParser(description="Calibrate per-station physics_params from last 30d telemetry+burn")
    parser.add_argument("--station", help="specific station id", default=None)
    parser.add_argument("--dry-run", action="store_true", help="do not write DB")
    args = parser.parse_args()
    targets = [args.station] if args.station else STATIONS
    db, is_pg = get_conn()
    print(f"DB: {'postgres' if is_pg else 'sqlite'} calibrate stations={targets} dry_run={args.dry_run}")
    results = []
    for sid in targets:
        try:
            r = calibrate_station(db, is_pg, sid, dry_run=args.dry_run)
            if r:
                results.append(r)
        except Exception as e:
            print(f"[{sid}] error: {e}")
            import traceback; traceback.print_exc()
    if hasattr(db, 'close'):
        try: db.close()
        except Exception: pass
    # exit code 0 even if insufficient data (expected before 30d)
    print(f"Done: {results}")

if __name__ == "__main__":
    main()
