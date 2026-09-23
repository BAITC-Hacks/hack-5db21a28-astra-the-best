import 'maplibre-gl/dist/maplibre-gl.css';
import { CityMap } from '@/features/city-map/CityMap';
import { scenario } from '@/data';

export default function Page() {
  return <CityMap scenario={scenario} />;
}
