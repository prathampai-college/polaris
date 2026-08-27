# PLAN 3: Connect TimescaleDB for Live Trend Charting

## Objective
Replace the static mock data in the HQ Dashboard's `TrendChart` with real, live telemetry and inventory data sourced from TimescaleDB (PostgreSQL).

## Current State
- `hq-dashboard/components/TrendChart.tsx` explicitly states it is a "mini sparkline placeholder for TimescaleDB trend (M5)".
- `hq-dashboard/app/page.tsx` passes a hardcoded array of dates and values to the chart component.
- The backend (`hq/app/main.py`) has a `/telemetry` endpoint but lacks historical aggregation.

## Actionable Steps
1. **Database Config:** Ensure `docker-compose.yml` is correctly spinning up TimescaleDB (`timescale/timescaledb`).
2. **Continuous Aggregates:** Update `shared/sql/schema.sql` (or a DB migration script) to create a TimescaleDB continuous aggregate view on the `telemetry` table. For example, aggregating temperature, wind, and diesel consumption per hour/day.
3. **HQ API Endpoint:**
   - Create a new endpoint `GET /telemetry/history?station_id=...&days=30` in `hq/app/main.py`.
   - Query the continuous aggregate view to fetch historical data efficiently.
4. **Dashboard Integration:**
   - Install a robust charting library like `recharts` or `chart.js` in `hq-dashboard`.
   - Update `page.tsx` to fetch data from `/telemetry/history` and map it to the charting component.
   - Plot the actual historical stock levels as a solid line, and overlay the ONNX model's forecast as a dashed line extending into the future.

## Impact
Moves the HQ Dashboard from a static demo to a production-ready operations center. Visualizing real trends and how the AI forecast aligns with historical data builds immense trust in the system's capabilities.
