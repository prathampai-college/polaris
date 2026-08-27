# PLAN 1: Upgrade 2D Grid to 3D Container X-Ray

## Objective
Transform the current basic 2D grid locator in the Field PWA and HQ Dashboard into an interactive 3D visualization using `Three.js` (via `@react-three/fiber` and `@react-three/drei`). This will provide a "3D X-Ray" view of the ISO-20 containers and the exact physical location of crates within them.

## Current State
- The UI uses a simple CSS grid (`<div className="grid grid-cols-3 gap-2">`) to map crates (e.g., `C1-K1`, `C2-K2`).
- Asset coordinates (`{x,y}`) are stored in the database and validated via `zod`, but are only displayed as raw text.

## Actionable Steps
1. **Dependencies:** Install `@react-three/fiber` and `@react-three/drei` in both the `field` and `hq-dashboard` packages.
2. **3D Models:** Create or import a lightweight glTF/wireframe model representing a standard ISO-20 shipping container and standard storage crates.
3. **Component Creation:** 
   - Build a `Container3D.tsx` component.
   - Map the `{x, y, z}` (or just `{x, y}` projected into 3D) coordinates from the SQLite database to position crates inside the container model.
4. **Interactivity:**
   - Allow the user to pan/zoom around the container (using `OrbitControls`).
   - When a QR code is scanned, or an asset is selected from the list, highlight the corresponding crate in the 3D view (e.g., changing its material color to glowing amber or red).
5. **Integration:** Replace the existing `Locator` component in `field/app/page.tsx` and `hq-dashboard/app/page.tsx` with the new 3D component.

## Impact
This adds a massive visual "wow" factor, proving the application's modern tech stack and making the physical retrieval of assets during a blizzard much faster by providing spacial awareness rather than just a grid coordinate.
