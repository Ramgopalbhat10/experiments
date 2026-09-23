/** Local tangent-plane projection matching tools/build_data.py. */
export class Geo {
  constructor(meta) {
    this.meta = meta;
  }

  toWorld(lat, lon) {
    const m = this.meta;
    return [(lon - m.lon0) * m.mLon, -(lat - m.lat0) * m.mLat];
  }

  toLatLon(x, z) {
    const m = this.meta;
    return [m.lat0 - z / m.mLat, m.lon0 + x / m.mLon];
  }
}
