# POLARIS — Final Pitch (SIH26062) — 4 Minutes

*Speaking script. Bracketed lines are stage/screen directions, not spoken. This version is built to work almost entirely off slides/screenshots — the only live moment is the connection-drop in Beat 2, which is stable and demo-ready. Everything else is walked through on-screen with recorded footage, screenshots, or narrated diagrams, so the pitch doesn't depend on fragile live components (LiDAR, SNN toggle, forecast push).*

*Where the deck says "built" — it's live and demoable if asked. Where it says "vision" — say so plainly. That line is your credibility, not a weakness.*

---

## 0:00 – 0:35 — Problem: Open with a real incident, not a hypothetical

> "In October 2013, something went wrong at India's own Bharati station in Antarctica. ISRO's ground operations there shut down. The Ministry of Earth Sciences ordered a formal inquiry — one serious enough that the minister said it would be examined from a national security angle. It's believed the crisis involved the station's diesel power supply being cut off, reportedly amid a fuel shortage.
>
> A former ISRO chairman asked the question that stuck with us: *'If fuel was running low, why wasn't it checked two months earlier, so a resupply could've been arranged in time? Unless there was some confusion about it.'*
>
> That confusion — not knowing, in time, that you're running out — is the entire problem POLARIS exists to solve. Not because we imagined a worst case. Because it already happened, at the exact station we're building for."

**[Screen: news headline / inquiry snippet, then the fuel gauge motif. Keep it factual and restrained — this is a real incident, not a dramatization.]**

---

## 0:35 – 1:20 — Blizzard & Polar Conditions: The real environment this has to survive

> "Bharati runs on a skeleton winter crew of about 23 people, cut off for six months. The satellite link is 20 to 50 kilobits per second, with multi-hour blackouts. GPS degrades under ionospheric disturbance. Visibility can drop below a meter in a whiteout.
>
> Other standard logistics system — cloud dashboards, continuous sync, GPS tracking — is built assuming none of that is true. It's built for an office with Wi-Fi. POLARIS is built for the six months when none of that exists."

**[Screen: the three failure conditions as icons — bandwidth, GPS, visibility — each crossed out against a "normal system" assumption.]**

---

## 1:20 – 2:10 — Beat 1 (the one live moment): the network doesn't need a network

> "Here's the one thing I want to show you live, because it's the core of the idea."

**[Live: kill Wi-Fi / pull the cable on the field tablet, in front of the judges.]**

> "The tablet keeps working. Staff keep logging inventory, keep filing a critical fuel request — completely offline. That part isn't the trick. The trick is what happens next: instead of waiting for a signal, a person physically carries that data to where a link exists — a QR handoff, like a USB stick made of light. We call this data muling, and it means the network is never really down, because people and vehicles *are* the network.
>
> When it reconnects, every update lands exactly once — no duplicates, no lost updates — even if two tablets edited the same record while both were offline. That's a hard distributed-systems problem, and we solved it with vector-clock conflict resolution, not a coin flip."

**[Screen, after the live moment: pre-recorded/screenshotted sync drawer showing Pending → Bundled → Acked, dedupe counter, size-saving numbers as captions.]**

---

## 2:10 – 2:45 — Beat 2: Stockout Forecast and tracking, walked through on slides

> "Two more pieces, shown here rather than live, since they depend on hardware we don't have in this room."

**[Screen: recorded/screenshot walkthrough — no live toggling.]**

> "First, forecasting. Under calm conditions, the system shows Bharati has 42 days of diesel left. Feed it real blizzard telemetry, and that number drops to 18 — automatically, and it files a critical resupply request without waiting for a person to notice. This runs on a power-aware neuromorphic model that stays nearly silent until conditions actually change, because for six months with no wall socket, every milliwatt matters.
>
> Second, local tracking. When GPS fails in a whiteout — which it does, from ionospheric interference — the system switches to its own LiDAR-and-camera-fused local map, tracking assets and people to under a meter of error, with zero satellite dependency."

---

## 2:45 – 3:05 — Architecture: How it's built (fast, plain-language)

> "Three ideas: a local sense of space that doesn't need GPS, a power-aware brain that thinks in bursts, and a network that uses people as carriers when the signal doesn't exist. All of it runs on hardware these stations already have."

---

## 3:05 – 3:45 — Feasibility & Roadmap: What we're building next (the vision, clearly labeled)

> "What you've seen so far is real and running. But the 2013 incident taught us something specific: the failure wasn't just technical, it was also about visibility and decision-making under pressure. So here's where we're taking this."

**[Screen: map with Bharati, Maitri, Himadri connected by pulsing lines.]**

> "**Mutual aid between stations** — if one station is running low and another has surplus, with a vessel between them, the system proposes a transfer automatically, not just another shipment from India. (LIVE: `GET /procurement/mutual-aid`.)
>
> **A 'two-month rule'** — a named, explicit long-horizon warning tier, so a slow-building shortage is flagged weeks out, not just when it turns critical. That's a direct answer to the exact question the former ISRO chairman asked in 2013. (LIVE: `FORECAST_60D` tier + readiness watch.)
>
> **Expedition planner, live** — centralized ISEA Antarctic + Himadri Arctic programs with voyage legs (chain/date/vessel-overlap validated), AL-1403-style manifests (cold-chain blocking, printable labels), custody stages, auto-pack stowage, per-station readiness **plus voyage cost rollup** (`GET /expeditions/{id}/cost`). Field tablets plan offline; DTN carries the plan home.
>
> **Personnel live on the map + buddy rule, live** — every sortie is a buddy pair (solo needs STATION_LEAD audit), roster is per-program (ANTARCTIC/ARCTIC/BOTH), and personnel dots + buddy lines ride the same GPS-denied local grid as cargo (`POST /tracking/personnel`).
>
> **Lot-level FEFO, live** — inventory is lot-tracked with earliest-expiry-first consume, `GET /lots` + `lot_code` in bulk import, synced via DTN.
>
> **Watchdog + triage + SLA, live** — overdue sorties auto-escalate to SOS after 30 minutes; distress follows `ACTIVE → ACK → RESPONDING → RESOLVED` with SLA breach `TRIAGE_SLA_BREACH` watchdog and every override audited; medical `ACK` auto-tasks a medevac sortie.
>
> **A decision audit trail** — every time a critical alert is overridden by a person — a resupply delayed, an alert dismissed — it's logged with who, when, and what the system's stated risk was at that moment. We're not taking authority away from station leadership. We're making sure a critical decision is never invisible again. (LIVE: `GET /overrides` + `GET /timeline`.)
>
> **A distress channel with no new infrastructure** — the same offline mesh that carries fuel data can carry an emergency signal from someone cut off from everyone else.
>
> **A digital twin for every winter before it happens** — station teams rehearse an entire simulated winter against this exact system before the real isolation begins."

---

## 3:45 – 4:00 — Close

> "Every nation running Antarctic stations treats fuel logistics as a formally hazardous operation. India's own station has already lived through what happens when that visibility fails. NCPOR is designing Maitri-II right now — the next generation of Indian Antarctic infrastructure. POLARIS is the software layer that station should have from day one, not the one built after the next inquiry."

**[Hold on: fuel gauge, now steady. Fade to logo.]**

---

## Presenter Notes — anticipated questions

- **"Is the LiDAR real?"** → Simulated for this pitch, explicitly badged in the UI as sim-only. Same fusion code path drives a real 2D LiDAR unit (RPLidar-class, ~$100) with no software change.
- **"Why a spiking neural net instead of a normal quantized model?"** → The forecast works on the simpler hybrid model alone; the SNN pillar demonstrates power-aware inference for a device with no wall socket for six months.
- **"What's built vs. vision?"** → Beat 1 (offline capture + DTN muling + conflict resolution) is live and demoable on request. Forecasting and local tracking are built and tested but shown via recording here, not live. Everything in "what we're building next" is roadmap — say so plainly if asked.
- **"Did the 2013 incident actually happen the way you described?"** → Yes, but be precise: it's documented that a Ministry of Earth Sciences inquiry was ordered into a shutdown at Bharati, reportedly tied to a fuel-related power cutoff, and it was also reportedly tangled with interpersonal conflict on the team. Say "a fuel-visibility gap was part of a documented crisis" — don't claim your dashboard alone would have prevented it, since the human-conflict dimension is real too.
- **"Has anything like this happened recently, not just in 2013?"** → Be honest: that's the most recent widely reported incident we found. The structural risk — isolation, heavy fuel dependency, manual stock-checks — holds regardless of whether another incident has occurred since.
