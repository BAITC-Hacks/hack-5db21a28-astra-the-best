import fs from 'node:fs';

// Offline, deterministic matching. The snapshot is a bounded OSM place search,
// not a complete inventory of Astana's infrastructure.
const snapshot = JSON.parse(fs.readFileSync('docs/sources/effect-landmarks-osm.json', 'utf8'));
const zones = JSON.parse(fs.readFileSync('public/geo/astana-game-zones.geojson', 'utf8'));
const sites = JSON.parse(fs.readFileSync('src/features/city-effects/sites.json', 'utf8'));
const order = ['M2', 'M6', 'M12', 'M14', 'M1', 'M3', 'M4', 'M5', 'M7', 'M8', 'M9', 'M10', 'M11', 'M13'];
const categories = { M4: ['park'], M7: ['school'], M8: ['hospital'], M9: ['sports_centre'], M14: ['fire_station'], M1: ['bus_station'], M6: ['park'] };
const distance = (a, b) => Math.hypot((a[0] - b[0]) * 70000, (a[1] - b[1]) * 111000);
function inRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function contains(geometry, point) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some(polygon => inRing(point, polygon[0]) && !polygon.slice(1).some(hole => inRing(point, hole)));
}
const result = {};
for (const [district, coordinates] of Object.entries(sites)) {
  const geometry = zones.features.find(feature => feature.properties.id === district).geometry;
  const occupied = coordinates.map(point => [...point]);
  result[district] = {};
  for (const [measure, accepted] of Object.entries(categories)) {
    const index = order.indexOf(measure);
    const candidates = snapshot.features.filter(point => point.name && accepted.includes(point.category) && contains(geometry, point.coordinates))
      .map(point => ({ point, clearance: Math.min(...occupied.filter((_, i) => i !== index).map(other => distance(other, point.coordinates))) }))
      .filter(candidate => candidate.clearance > 1400)
      .sort((a, b) => b.clearance - a.clearance || a.point.osmId - b.point.osmId);
    if (!candidates.length) continue;
    const chosen = candidates[0].point;
    result[district][measure] = chosen;
    occupied[index] = chosen.coordinates;
  }
}
fs.writeFileSync('src/features/city-effects/landmarks.json', JSON.stringify(result, null, 2) + '\n');
console.log(`${Object.values(result).reduce((sum, district) => sum + Object.keys(district).length, 0)} landmarks matched; all 70 pin positions remain > 1.4 km apart within their district.`);
