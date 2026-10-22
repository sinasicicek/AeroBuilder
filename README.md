# AeroBuilder

**AeroBuilder** is an interactive, web-based application tailored for aeromodelling enthusiasts. It allows you to design RC monoplane aircraft by inputting dimensions, verifying aerodynamic stability in real-time, and generating 1:1 scale templates ready for physical construction (using materials like Depron or Balsa wood).

## Live Demo
*https://aerobuilder-calc.netlify.app/*

## Features
- **Real-Time 2D Visualization:** Instantly see your design changes reflected on a dynamically rendered top and side view, including an accurate Center of Gravity (CG) marker.
- **Clean workspace:** parameters on the left, the model filling the rest of the screen and the key numbers on top. Power & weight choices (flight category, battery, servos) show their effect right below each selector (share of the total weight, battery position for the CG, suggested motor/ESC/cells); analysis, weight breakdown and electric details open on demand in a side panel from the summary bar.
- **Flight Assistant (Aerodynamic Consultant):** Automatically calculates key metrics (MAC, CG, Neutral Point, Static Margin, Aspect Ratio) and warns you about potentially unstable or unflyable designs based on proven aerodynamic rules.
- **1:1 PDF Template Export:** Tiling logic that seamlessly splits your aircraft design across multiple standard A4 pages with alignment crosshairs for easy printing, taping, and cutting.
- **SEO per language:** each language has its own URL (`/pt/`, `/en/`, `/es/`, `/fr/`, `/zh/`) generated at build time by `seo/seoPlugin.ts` from `seo/seo.json` — localised title, description, keywords, Open Graph/Twitter card with a 1200×630 image (`public/og/`), `hreflang` + canonical links, JSON-LD (`WebApplication`) and crawlable text that doubles as the loading screen. The build also writes `sitemap.xml` (with hreflang alternates) and `robots.txt`. The app follows the language in the URL and updates it when the language is changed. Google Analytics 4 events: `export_pdf`, `export_stl`, `load_example`, `share_link`, `change_language`.
- **Internationalization & Unit Conversion:** Portuguese (PT-BR), English, Spanish, French and Simplified Chinese — UI, warnings, examples, PDF report and the STL README (the PDF is produced in English for Chinese, since its built-in fonts have no CJK glyphs). The language is detected from the browser and can be changed in Settings. Locales live in `src/locales/*.ts` and must all define the same keys (a missing translation fails the type check). Toggle between centimetres and millimetres while retaining physical scale accuracy.
- **Editable Control Surfaces:** Ailerons/elevons (start, end, chord %), elevator and rudder chord %, with live sizes and sizing checks — shown in 2D, 3D and the PDF.
- **3D Printing (STL export):** Splits the aircraft into sections that fit your printer's build volume, ready for LW-PLA in spiral vase mode, with keyhole spar channels for carbon rods, automatic chord-wise splits for large chords, and a ZIP with a README (slicer settings, parts list, spar lengths, assembly). Component pockets are cut automatically: wing servo pockets, fuselage bays for battery/ESC and receiver/servos (or battery/ESC/receiver bays in a flying wing's centre section).
- **Internal structure & printable fittings:** Carbon spars, servo mounts (wing plate / fuselage tray) and compartment hatches are shown in the 3D x-ray and 2D views and exported as STL (printed in normal mode). Flying wings get a Zagi-style trailing-edge cut-out that moves the pusher motor forward.
- **Weight & Balance:** Estimates the all-up weight (printed LW-PLA shells, carbon spars, motor, prop, ESC, battery, servos, receiver), places the components and pushrods in 2D/3D (x-ray view), and solves the battery position that puts the CG on target — warning when ballast would be needed.
- **Example Projects:** Six checked designs (trainers, sport, motor glider, flying wings) that balance without ballast — load one and adapt it.
- **Flying-wing CG (Hepperle):** Neutral point at 25 % of the MAC at its span station; CG placed by a user-set static margin (2–12 %).
- **Physical fit & pushrod exits:** every onboard part is seated against the real inner envelope (airfoil or fuselage section, dowel sleeves, ESC) — the automatic battery choice only considers packs that fit, and on a flying wing the pack may lie across the wing to sit further forward. Tail pushrod exits (bay wall and skin) are computed, marked in 2D/3D with their guide tubes, and listed in the README for drilling.
- **Assembly & wing mount:** wing halves joined by a printed joiner plate flush in a recess under the root; on the high-wing trainer the whole wing is held by rubber bands over two transverse dowels (printed sleeves, trailing-edge guard, hardware list and drilling positions in the README). Dowels and bands are drawn in 2D/3D, and an exploded 3D view lifts the wing and separates the halves and print sections.
- **Conventional CG by static margin:** Neutral point from wing + horizontal tail (downwash, tail efficiency) minus the fuselage's destabilising contribution (Gilruth/Raymer K_f); CG placed by a user-set static margin (5–25 %, default 12 %), with a warning when it falls outside 20–35 % of the MAC.
- **Shareable Projects:** "Share" copies a link with the whole design compressed into the URL — it reopens the same aircraft on any device.
- **Project Summary Bar:** Wingspan, wing area, aspect ratio, estimated weight, wing loading, static margin and CG at a glance, colour-coded.
- **Dark Mode Support:** A sleek, toggleable dark mode for comfortable designing in any lighting condition.

## Tech Stack
- **Framework:** React.js (with TypeScript) bootstrapped via Vite.
- **Styling:** TailwindCSS (v3) for rapid, responsive, and themeable UI development.
- **Visualization:** Native HTML5 Canvas API.
- **PDF Generation:** jsPDF for precise, tiled PDF rendering.
- **3D / STL:** three.js + react-three-fiber; STL files zipped with fflate (loaded on demand).
- **Internationalization:** react-i18next.

## How to run locally

1. **Clone the repository:**
   ```bash
   git clone <your-repo-url>
   cd aerobuilder
   ```

2. **Install dependencies:**
   Make sure you have Node.js installed, then run:
   ```bash
   npm install
   ```

3. **Start the development server:**
   ```bash
   npm run dev
   ```

4. **Access the application:**
   Open your browser and navigate to the local URL provided in the terminal (typically `http://localhost:5173/`).

5. **Build for production:**
   To create a production-ready build, run:
   ```bash
   npm run build
   ```
   You can then preview the build with:
   ```bash
   npm run preview
   ```

## License

[MIT](LICENSE) © 2026 Álvaro Severo Marcus. You may use, copy, modify and distribute this software, including commercially, as long as the copyright notice and the license text are kept.

Version 1.0 (tag `v1.0`) is registered with INPI (Brazil) as a computer program.
