#!/usr/bin/env python3
"""
Bakes real-world data for Mount Rainier National Park into compact game assets.

Sources (all fetched at build time, cached under tools/.cache):
  * Elevation  - AWS Terrain Tiles (Terrarium encoding, USGS 3DEP/NED in the US)
  * Land cover - Sentinel-2 cloudless 2016 by EOX (CC BY 4.0), classified into
                 forest / meadow / bare rock / snow
  * Vectors    - OpenStreetMap via Overpass (ODbL): glaciers, lakes, rivers,
                 trails, roads, waterfalls, peaks, buildings, viewpoints

Outputs (in ../assets):
  terrain.png    R,G = elevation in decimetres (uint16, hi/lo byte)
                 B   = flag bits (1 lake, 2 river, 4 road, 8 glacier)
  landcover.png  R = forest density, G = meadow/vegetation, B = snow/ice
  features.json  vectors in local metres (x east, z south) + metadata

Usage:  pip install numpy pillow && python3 tools/build_data.py
"""
import concurrent.futures as cf
import io
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, ".cache")
OUT = os.path.join(HERE, "..", "assets")

# --- World frame -----------------------------------------------------------
LAT0, LON0 = 46.845, -121.715       # centre of the baked square
SIZE_M = 40960.0                    # 40.96 km square
RES = 2048                          # 20 m per texel
CELL = SIZE_M / RES
M_LAT = 111132.954 - 559.822 * math.cos(2 * math.radians(LAT0)) + 1.175 * math.cos(4 * math.radians(LAT0))
M_LON = 111412.84 * math.cos(math.radians(LAT0)) - 93.5 * math.cos(3 * math.radians(LAT0))

HALF = SIZE_M / 2
LAT_N, LAT_S = LAT0 + HALF / M_LAT, LAT0 - HALF / M_LAT
LON_W, LON_E = LON0 - HALF / M_LON, LON0 + HALF / M_LON

DEM_Z = 13
IMG_Z = 13
UA = "rainier-explorer-databake/1.0 (three.js hobby experiment)"

OVERPASS = [
    "https://z.overpass-api.de/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]


def to_local(lat, lon):
    return (lon - LON0) * M_LON, -(lat - LAT0) * M_LAT


def fetch(url, cache_name, data=None, tries=5, timeout=120):
    path = os.path.join(CACHE, cache_name)
    if os.path.exists(path) and os.path.getsize(path) > 0:
        with open(path, "rb") as f:
            return f.read()
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = r.read()
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "wb") as f:
                f.write(body)
            return body
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 ** i)
    raise RuntimeError(f"failed {url}: {last}")


# --- Web mercator helpers --------------------------------------------------
def merc_px(lat, lon, z):
    n = 2 ** z * 256
    x = (lon + 180.0) / 360.0 * n
    y = (1.0 - np.arcsinh(np.tan(np.radians(lat))) / math.pi) / 2.0 * n
    return x, y


def grid_latlon():
    c = (np.arange(RES) + 0.5) * CELL - HALF
    xs, zs = np.meshgrid(c, c)                   # row = z (north -> south)
    lat = LAT0 - zs / M_LAT
    lon = LON0 + xs / M_LON
    return lat, lon


def mosaic(z, url_fn, cache_dir, decode):
    """Fetch every tile covering the bbox at zoom z; return (array, x0px, y0px)."""
    x0, y0 = merc_px(LAT_N, LON_W, z)
    x1, y1 = merc_px(LAT_S, LON_E, z)
    tx0, ty0 = int(x0 // 256), int(y0 // 256)
    tx1, ty1 = int(x1 // 256), int(y1 // 256)
    tiles = [(tx, ty) for ty in range(ty0, ty1 + 1) for tx in range(tx0, tx1 + 1)]
    print(f"  {len(tiles)} tiles @ z{z}")

    def get(t):
        tx, ty = t
        return t, fetch(url_fn(z, tx, ty), f"{cache_dir}/{z}_{tx}_{ty}")

    arr = None
    with cf.ThreadPoolExecutor(8) as ex:
        for (tx, ty), body in ex.map(get, tiles):
            a = decode(body)
            if arr is None:
                shape = ((ty1 - ty0 + 1) * 256, (tx1 - tx0 + 1) * 256) + a.shape[2:]
                arr = np.zeros(shape, dtype=a.dtype)
            oy, ox = (ty - ty0) * 256, (tx - tx0) * 256
            arr[oy:oy + 256, ox:ox + 256] = a
    return arr, tx0 * 256, ty0 * 256


def bilinear(arr, px, py):
    h, w = arr.shape[:2]
    px = np.clip(px - 0.5, 0, w - 1.001)
    py = np.clip(py - 0.5, 0, h - 1.001)
    x0 = np.floor(px).astype(np.int32)
    y0 = np.floor(py).astype(np.int32)
    fx, fy = px - x0, py - y0
    if arr.ndim == 3:
        fx, fy = fx[..., None], fy[..., None]
    a, b = arr[y0, x0], arr[y0, x0 + 1]
    c, d = arr[y0 + 1, x0], arr[y0 + 1, x0 + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def build_dem(lat, lon):
    print("Elevation (AWS terrain tiles, terrarium)...")

    def dec(body):
        a = np.asarray(Image.open(io.BytesIO(body)).convert("RGB"), dtype=np.float32)
        return a[..., 0] * 256.0 + a[..., 1] + a[..., 2] / 256.0 - 32768.0

    arr, ox, oy = mosaic(
        DEM_Z,
        lambda z, x, y: f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
        "dem", dec)
    px, py = merc_px(lat, lon, DEM_Z)
    h = bilinear(arr, px - ox, py - oy).astype(np.float32)
    print(f"  elevation range {h.min():.0f} .. {h.max():.0f} m")
    return h


def build_imagery(lat, lon):
    print("Imagery (Sentinel-2 cloudless 2016, EOX)...")

    def dec(body):
        return np.asarray(Image.open(io.BytesIO(body)).convert("RGB"), dtype=np.float32)

    arr, ox, oy = mosaic(
        IMG_Z,
        lambda z, x, y: f"https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg",
        "s2", dec)
    px, py = merc_px(lat, lon, IMG_Z)
    return bilinear(arr, px - ox, py - oy)


def classify(img, h):
    r, g, b = img[..., 0], img[..., 1], img[..., 2]
    v = (r + g + b) / 3.0
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    sat = (mx - mn) / (mx + 1.0)
    exg = 2 * g - r - b

    def ramp(x, a, b_):
        return np.clip((x - a) / (b_ - a), 0, 1)

    # The 2016 mosaic is dark: closed-canopy conifer forest sits around v=15..30,
    # subalpine meadows 35..70 with strong excess-green, rock/pumice is bright and grey.
    snow = ramp(v, 130, 180) * (1 - ramp(sat, 0.18, 0.35))
    # deep shadow in low valleys is still forest even when it reads bluish
    greenish = np.maximum(ramp(exg, 0, 10), 1 - ramp(h, 1300, 1700))
    forest = (1 - ramp(v, 26, 44)) * greenish * (1 - ramp(h, 1800, 2100))
    forest *= (1 - snow)
    veg = ramp(v, 22, 40) * ramp(exg, 6, 26) * (1 - snow) * (1 - ramp(h, 2150, 2450))
    veg = np.maximum(veg * (1 - forest), 0)
    return forest, veg, snow


# --- OpenStreetMap ---------------------------------------------------------
def overpass():
    bbox = f"{LAT_S},{LON_W},{LAT_N},{LON_E}"
    q = f"""
[out:json][timeout:180];
(
  way["natural"="glacier"]({bbox});
  relation["natural"="glacier"]({bbox});
  way["natural"="water"]({bbox});
  relation["natural"="water"]({bbox});
  way["waterway"~"^(river|stream)$"]({bbox});
  node["waterway"="waterfall"]({bbox});
  node["natural"~"^(peak|volcano|saddle)$"]["name"]({bbox});
  node["tourism"~"^(viewpoint|information|camp_site|alpine_hut)$"]({bbox});
  node["highway"="trailhead"]({bbox});
  nwr["man_made"="tower"]({bbox});
  nwr["tower:type"]({bbox});
  way["highway"~"^(path|footway|track|bridleway|steps)$"]({bbox});
  way["highway"~"^(primary|secondary|tertiary|unclassified|residential|service)$"]({bbox});
  way["building"]({bbox});
);
out geom qt;
"""
    data = urllib.parse.urlencode({"data": q}).encode()
    last = None
    for ep in OVERPASS:
        try:
            print(f"  overpass: {ep}")
            body = fetch(ep, "osm/overpass.json", data=data, tries=2, timeout=240)
            js = json.loads(body)
            if "elements" in js:
                return js
        except Exception as e:  # noqa: BLE001
            last = e
            p = os.path.join(CACHE, "osm/overpass.json")
            if os.path.exists(p):
                os.remove(p)
    raise RuntimeError(f"overpass failed: {last}")


def simplify(pts, tol):
    """Douglas-Peucker on a list of (x, z). Closed rings stay closed."""
    if len(pts) < 3:
        return pts
    if math.dist(pts[0], pts[-1]) < 1e-6:
        body = simplify(list(pts[:-1]), tol) if len(pts) > 4 else list(pts[:-1])
        return body + [body[0]]
    a = np.asarray(pts, dtype=np.float64)
    keep = np.zeros(len(a), dtype=bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(a) - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        p, q = a[i], a[j]
        d = q - p
        L = math.hypot(*d) or 1e-9
        seg = a[i + 1:j]
        dist = np.abs(d[0] * (seg[:, 1] - p[1]) - d[1] * (seg[:, 0] - p[0])) / L
        k = int(np.argmax(dist))
        if dist[k] > tol:
            m = i + 1 + k
            keep[m] = True
            stack += [(i, m), (m, j)]
    return [tuple(x) for x in a[keep]]


def geom_local(geom):
    return [to_local(p["lat"], p["lon"]) for p in geom if p]


def assemble_rings(members, role):
    """Join relation member ways into closed rings."""
    segs = [geom_local(m.get("geometry", [])) for m in members
            if m.get("type") == "way" and m.get("role", "outer") in (role, "" if role == "outer" else role)]
    segs = [s for s in segs if len(s) >= 2]
    rings = []
    while segs:
        ring = segs.pop(0)
        changed = True
        while changed and (math.dist(ring[0], ring[-1]) > 1.0):
            changed = False
            for i, s in enumerate(segs):
                if math.dist(ring[-1], s[0]) < 1.0:
                    ring += s[1:]
                elif math.dist(ring[-1], s[-1]) < 1.0:
                    ring += s[::-1][1:]
                elif math.dist(ring[0], s[-1]) < 1.0:
                    ring = s[:-1] + ring
                elif math.dist(ring[0], s[0]) < 1.0:
                    ring = s[::-1][:-1] + ring
                else:
                    continue
                segs.pop(i)
                changed = True
                break
        if len(ring) >= 4:
            rings.append(ring)
    return rings


def to_px(pts):
    return [((x + HALF) / CELL, (z + HALF) / CELL) for x, z in pts]


def inside_bounds(pts, margin=0):
    return any(abs(x) < HALF - margin and abs(z) < HALF - margin for x, z in pts)


def flat(pts, nd=0):
    out = []
    for x, z in pts:
        out += [round(x, nd) if nd else int(round(x)), round(z, nd) if nd else int(round(z))]
    return out


def process_osm(js, h):
    els = js["elements"]
    print(f"  {len(els)} OSM elements")
    polys = {"glacier": [], "water": []}   # (outer rings, inner rings, tags)
    streams, trails, roads, points, buildings = [], [], [], [], []

    for e in els:
        t = e.get("tags", {})
        typ = e["type"]
        if typ == "node":
            points.append(e)
            continue
        if typ == "relation":
            kind = "glacier" if t.get("natural") == "glacier" else "water" if t.get("natural") == "water" else None
            if kind:
                outer = assemble_rings(e.get("members", []), "outer")
                inner = assemble_rings(e.get("members", []), "inner")
                if outer:
                    polys[kind].append((outer, inner, t))
            elif "man_made" in t or "tower:type" in t:
                b = e.get("bounds")
                if b:
                    points.append({"lat": (b["minlat"] + b["maxlat"]) / 2, "lon": (b["minlon"] + b["maxlon"]) / 2, "tags": t})
            continue
        pts = geom_local(e.get("geometry", []))
        if len(pts) < 2:
            continue
        if t.get("natural") == "glacier":
            polys["glacier"].append(([pts], [], t))
        elif t.get("natural") == "water":
            polys["water"].append(([pts], [], t))
        elif t.get("waterway") in ("river", "stream"):
            streams.append((pts, t))
        elif t.get("building"):
            buildings.append((pts, t))
        elif t.get("man_made") == "tower" or "tower:type" in t:
            cx = sum(p[0] for p in pts) / len(pts)
            cz = sum(p[1] for p in pts) / len(pts)
            points.append({"x": cx, "z": cz, "tags": t})
        elif t.get("highway") in ("path", "footway", "track", "bridleway", "steps"):
            trails.append((pts, t))
        elif "highway" in t:
            roads.append((pts, t))

    # --- rasterise masks (2x supersampled, then thresholded) ----------------
    SS = 2

    def raster(polylist, value=255):
        im = Image.new("L", (RES * SS, RES * SS), 0)
        dr = ImageDraw.Draw(im)
        for outer, inner, _ in polylist:
            for ring in outer:
                dr.polygon([(x * SS, z * SS) for x, z in to_px(ring)], fill=value)
            for ring in inner:
                dr.polygon([(x * SS, z * SS) for x, z in to_px(ring)], fill=0)
        return np.asarray(im.resize((RES, RES), Image.BILINEAR), dtype=np.float32) / 255.0

    glacier = raster(polys["glacier"])

    def lines(items, width_m):
        im = Image.new("L", (RES * SS, RES * SS), 0)
        dr = ImageDraw.Draw(im)
        w = max(1, int(round(width_m / CELL * SS)))
        for pts, _ in items:
            dr.line([(x * SS, z * SS) for x, z in to_px(pts)], fill=255, width=w, joint="curve")
        return np.asarray(im.resize((RES, RES), Image.BILINEAR), dtype=np.float32) / 255.0

    rivers = [(p, t) for p, t in streams if t.get("waterway") == "river"]
    river_mask = lines(rivers, 26)
    majors = [(p, t) for p, t in roads if t.get("highway") in ("primary", "secondary", "tertiary")]
    road_mask = lines(majors, 14)

    # --- lakes: level from shoreline, carve terrain -------------------------
    lakes = []
    lake_mask = np.zeros((RES, RES), dtype=np.float32)
    for outer, inner, t in polys["water"]:
        if t.get("water") in ("river", "stream", "canal"):
            continue
        ring = outer[0]
        if not inside_bounds(ring, 50):
            continue
        area = 0.0
        for (x1, z1), (x2, z2) in zip(ring, ring[1:] + ring[:1]):
            area += x1 * z2 - x2 * z1
        area = abs(area) / 2
        if area < 150:
            continue
        # shoreline elevation: low percentile of DEM around the ring
        samples = []
        for x, z in ring:
            i = int((x + HALF) / CELL)
            j = int((z + HALF) / CELL)
            if 0 <= i < RES and 0 <= j < RES:
                samples.append(h[j, i])
        if not samples:
            continue
        level = float(np.percentile(samples, 8)) - 0.3
        im = Image.new("L", (RES * SS, RES * SS), 0)
        dr = ImageDraw.Draw(im)
        for r_ in outer:
            dr.polygon([(x * SS, z * SS) for x, z in to_px(r_)], fill=255)
        for r_ in inner:
            dr.polygon([(x * SS, z * SS) for x, z in to_px(r_)], fill=0)
        m = np.asarray(im.resize((RES, RES), Image.BILINEAR), dtype=np.float32) / 255.0
        inside = m > 0.5
        shore = (m > 0.02) & ~inside
        # carve the bed below the surface, and keep a thin berm just above the
        # waterline around it so there is no dry trench below lake level
        depth = 0.8 + 2.2 * np.clip((m[inside] - 0.5) * 2, 0, 1)
        h[inside] = np.minimum(h[inside], level - depth)
        h[shore] = np.maximum(h[shore], level + 0.15)
        lake_mask = np.maximum(lake_mask, m)
        simp = [simplify(r_, 3.0) for r_ in outer]
        holes = [simplify(r_, 3.0) for r_ in inner]
        lakes.append({
            "name": t.get("name", ""),
            "level": round(level, 2),
            "area": int(area),
            "outer": [flat(r_) for r_ in simp],
            "inner": [flat(r_) for r_ in holes],
        })
    print(f"  {len(lakes)} lakes")

    # --- vectors ------------------------------------------------------------
    def keep_line(pts, tol):
        if not inside_bounds(pts):
            return None
        s = simplify(pts, tol)
        return flat(s) if len(s) >= 2 else None

    out_streams = []
    for pts, t in streams:
        f = keep_line(pts, 5.0)
        if f:
            out_streams.append({"k": 1 if t.get("waterway") == "river" else 0, "n": t.get("name", ""), "p": f})

    out_trails = []
    for pts, t in trails:
        f = keep_line(pts, 2.5)
        if f:
            out_trails.append({
                "n": t.get("name", ""),
                "k": {"track": 1, "footway": 2, "steps": 2}.get(t.get("highway"), 0),
                "s": t.get("surface", ""),
                "p": f,
            })

    out_roads = []
    for pts, t in roads:
        f = keep_line(pts, 2.5)
        if f:
            hw = t.get("highway")
            out_roads.append({"n": t.get("name", t.get("ref", "")),
                              "k": {"primary": 3, "secondary": 3, "tertiary": 2, "unclassified": 1}.get(hw, 0),
                              "p": f})

    out_buildings = []
    for pts, t in buildings:
        if not inside_bounds(pts, 10) or len(pts) < 4:
            continue
        lv = t.get("building:levels", "")
        try:
            lv = float(lv)
        except ValueError:
            lv = 0
        out_buildings.append({"n": t.get("name", ""), "l": lv, "p": flat(simplify(pts[:-1], 0.5), 1)})

    out_points = []
    for e in points:
        t = e.get("tags", {})
        if "x" in e:
            x, z = e["x"], e["z"]
        else:
            x, z = to_local(e["lat"], e["lon"])
        if abs(x) > HALF or abs(z) > HALF:
            continue
        if t.get("waterway") == "waterfall":
            k = "waterfall"
        elif t.get("natural") in ("peak", "volcano"):
            k = "peak"
        elif t.get("natural") == "saddle":
            k = "saddle"
        elif t.get("tourism") == "viewpoint":
            k = "viewpoint"
        elif t.get("man_made") == "tower" or "tower:type" in t:
            k = "tower"
        elif t.get("highway") == "trailhead":
            k = "trailhead"
        elif t.get("tourism") in ("camp_site", "alpine_hut"):
            k = "camp"
        elif t.get("tourism") == "information":
            if t.get("information") not in ("board", "office", "visitor_centre"):
                continue
            k = "info"
        else:
            continue
        ele = t.get("ele", "")
        try:
            ele = float(ele)
        except ValueError:
            ele = None
        out_points.append({"k": k, "n": t.get("name", ""), "x": int(round(x)), "z": int(round(z)),
                           "e": ele, "t": t.get("tower:type", "")})

    glacier_names = []
    for outer, _, t in polys["glacier"]:
        if t.get("name"):
            ring = max(outer, key=len)
            cx = sum(p[0] for p in ring) / len(ring)
            cz = sum(p[1] for p in ring) / len(ring)
            if abs(cx) < HALF and abs(cz) < HALF:
                glacier_names.append({"n": t["name"], "x": int(cx), "z": int(cz)})

    feats = {
        "lakes": lakes,
        "streams": out_streams,
        "trails": out_trails,
        "roads": out_roads,
        "buildings": out_buildings,
        "points": out_points,
        "glaciers": glacier_names,
    }
    masks = {"glacier": glacier, "river": river_mask, "road": road_mask, "lake": lake_mask}
    return feats, masks


def main():
    os.makedirs(CACHE, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    print(f"Bounds lat {LAT_S:.4f}..{LAT_N:.4f}  lon {LON_W:.4f}..{LON_E:.4f}")
    lat, lon = grid_latlon()
    h = build_dem(lat, lon)
    img = build_imagery(lat, lon)

    print("OpenStreetMap (Overpass)...")
    js = overpass()
    feats, masks = process_osm(js, h)

    print("Classifying land cover...")
    forest, veg, snow = classify(img, h)
    snow = np.maximum(snow, masks["glacier"] * 0.9)
    water = np.maximum(masks["lake"], masks["river"])
    forest *= (1 - water) * (1 - masks["road"])
    veg *= (1 - water)

    def smooth(a, r=1):
        im = Image.fromarray(np.clip(a * 255, 0, 255).astype(np.uint8))
        return np.asarray(im.filter(ImageFilter.GaussianBlur(r)), dtype=np.float32) / 255.0

    lc = np.stack([smooth(forest, 0.8), smooth(veg, 0.8), smooth(snow, 0.6)], axis=-1)
    Image.fromarray(np.clip(lc * 255 + 0.5, 0, 255).astype(np.uint8), "RGB").save(
        os.path.join(OUT, "landcover.png"), optimize=True)

    dm = np.clip(np.round(h * 10.0), 0, 65535).astype(np.uint16)
    flags = ((masks["lake"] > 0.5) * 1 | (masks["river"] > 0.35) * 2 |
             (masks["road"] > 0.4) * 4 | (masks["glacier"] > 0.5) * 8).astype(np.uint8)
    rgb = np.stack([(dm >> 8).astype(np.uint8), (dm & 255).astype(np.uint8), flags], axis=-1)
    Image.fromarray(rgb, "RGB").save(os.path.join(OUT, "terrain.png"), optimize=True)

    feats["meta"] = {
        "lat0": LAT0, "lon0": LON0, "size": SIZE_M, "res": RES, "cell": CELL,
        "mLat": M_LAT, "mLon": M_LON,
        "minH": float(h.min()), "maxH": float(h.max()),
        "attribution": [
            "Elevation: AWS Terrain Tiles / USGS 3DEP",
            "Land cover derived from Sentinel-2 cloudless 2016 by EOX IT Services GmbH (CC BY 4.0), contains modified Copernicus Sentinel data 2016",
            "Map data (c) OpenStreetMap contributors, ODbL",
        ],
    }
    with open(os.path.join(OUT, "features.json"), "w") as f:
        json.dump(feats, f, separators=(",", ":"))
    for fn in ("terrain.png", "landcover.png", "features.json"):
        p = os.path.join(OUT, fn)
        print(f"  wrote {fn}: {os.path.getsize(p) / 1e6:.2f} MB")
    print({k: len(v) for k, v in feats.items() if isinstance(v, list)})


if __name__ == "__main__":
    sys.exit(main())
