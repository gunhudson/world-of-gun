// Sun position for a lat/lon/instant (NOAA low-precision solar equations, good to ~0.5 degree).
// Pure. altitude: degrees above the horizon. azimuth: degrees clockwise from north.
const rad = Math.PI / 180;

export function sunPosition(ms, lat, lon) {
  const d = ms / 86400000 + 2440587.5 - 2451545.0;             // days since J2000
  const g = (357.529 + 0.98560028 * d) * rad;                  // mean anomaly
  const q = 280.459 + 0.98564736 * d;                          // mean longitude
  const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad; // ecliptic longitude
  const e = (23.439 - 0.00000036 * d) * rad;                   // obliquity
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;    // hours
  const lst = (gmst * 15 + lon) * rad;
  const ha = lst - ra;                                         // hour angle
  const phi = lat * rad;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(ha));
  const norm = x => ((x % 360) + 360) % 360;
  const haDeg = norm(ha / rad + 180) - 180;                    // -180..180, negative = before solar noon
  return { altitude: alt / rad, azimuth: norm(az / rad), rising: haDeg < 0 };
}

// Phase bands (degrees of altitude). Table so the look of the realm can be retuned.
export const SUN_PHASES = [
  { phase: "night",  below: -6 },                 // sun more than 6 below the horizon
  { phase: "dawn",   below: 0, rising: true },    // civil twilight, morning
  { phase: "dusk",   below: 0, rising: false },   // civil twilight, evening
  { phase: "golden", below: 8 },                  // low sun, either end of the day
  { phase: "day",    below: Infinity },
];
export function sunPhase(pos) {
  for (const b of SUN_PHASES) {
    if (pos.altitude < b.below && (b.rising === undefined || b.rising === pos.rising)) return b.phase;
  }
  return "day";
}
export function sunNow(ms, lat, lon) {
  const p = sunPosition(ms, lat, lon);
  return { altitude: Math.round(p.altitude * 10) / 10, azimuth: Math.round(p.azimuth * 10) / 10, phase: sunPhase(p) };
}

// WMO weather interpretation codes (open-meteo `weather_code`).
export const WMO = {
  0: "Clear", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Rime fog",
  51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle", 56: "Freezing drizzle", 57: "Freezing drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain",
  71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains",
  80: "Light showers", 81: "Showers", 82: "Violent showers", 85: "Snow showers", 86: "Snow showers",
  95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Thunderstorm with hail",
};
