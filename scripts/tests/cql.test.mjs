import test from 'node:test';
import assert from 'node:assert/strict';

function geoJsonToWkt(geom) {
  if (!geom || !geom.type) return '';
  const type = geom.type.toUpperCase();

  switch (type) {
    case 'POINT':
      return `POINT(${geom.coordinates[0]} ${geom.coordinates[1]})`;
    case 'LINESTRING':
      return `LINESTRING(${geom.coordinates.map((c) => `${c[0]} ${c[1]}`).join(', ')})`;
    case 'POLYGON': {
      const rings = geom.coordinates.map(
        (ring) => `(${ring.map((c) => `${c[0]} ${c[1]}`).join(', ')})`
      );
      return `POLYGON(${rings.join(', ')})`;
    }
    default:
      return '';
  }
}

function buildLayerCql(operation, refDatasetId, geomField = 'geom', refGeomField = 'geom', filterCql = 'INCLUDE') {
  const opUpper = (operation || 'INTERSECTS').toUpperCase();
  return `${opUpper}(${geomField}, collectGeometries(queryCollection('${refDatasetId}', '${refGeomField}', '${filterCql}')))`;
}

test('CQL Suite: Converts Point GeoJSON to WKT', () => {
  const geom = { type: 'Point', coordinates: [77.5946, 12.9716] };
  const wkt = geoJsonToWkt(geom);
  assert.strictEqual(wkt, 'POINT(77.5946 12.9716)');
});

test('CQL Suite: Converts Polygon GeoJSON to WKT', () => {
  const geom = {
    type: 'Polygon',
    coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]],
  };
  const wkt = geoJsonToWkt(geom);
  assert.strictEqual(wkt, 'POLYGON((0 0, 0 1, 1 1, 1 0, 0 0))');
});

test('CQL Suite: Builds cross-layer queryCollection CQL correctly', () => {
  const cql = buildLayerCql('INTERSECTS', 'admin_zones', 'the_geom', 'boundary', "status = 'active'");
  assert.strictEqual(
    cql,
    "INTERSECTS(the_geom, collectGeometries(queryCollection('admin_zones', 'boundary', 'status = 'active'')))"
  );
});
