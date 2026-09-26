import pg from 'pg';
import { chargerOsm, trierElements, type OverpassElement } from '../scripts/osm.js';
import { ELEMENTS_OSM } from './fixtures/osm.js';

describe('Import OSM (e2e)', () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

  beforeAll(async () => {
    await client.connect();
    await client.query('DELETE FROM carrefour');
    await client.query('DELETE FROM feu');
  });

  afterAll(async () => {
    await client.query('DELETE FROM carrefour');
    await client.query('DELETE FROM feu');
    await client.end();
  });

  it('should load the osm_* tables and sync the signals of the commune, without creating carrefours', async () => {
    const bilan = await chargerOsm(client, trierElements({ elements: ELEMENTS_OSM }));
    expect(bilan).toEqual({ signaux: 9, voies: 5, trams: 1, feux: { presents: 8, nouveaux: 8, disparus: 0 } });

    const { rows } = await client.query(
      "SELECT type, count(*)::int AS n FROM feu GROUP BY type ORDER BY type",
    );
    expect(rows).toEqual([
      { type: 'vehicule', n: 4 },
      { type: 'pieton', n: 4 },
    ]);
    const { rows: carrefours } = await client.query('SELECT count(*)::int AS n FROM carrefour');
    expect(carrefours[0].n).toBe(0);
  });

  it('should keep manual groupings on re-import, update moved signals and flag vanished ones', async () => {
    const { rows } = await client.query(`
      INSERT INTO carrefour (slug, nom, geom) VALUES ('a', 'A', ST_SetSRID(ST_MakePoint(6.03, 47.25), 4326))
      RETURNING id
    `);
    await client.query('UPDATE feu SET carrefour_id = $1 WHERE osm_id IN (101, 105)', [rows[0].id]);

    const deplace = ELEMENTS_OSM.filter((e) => !(e.type === 'node' && e.id === 105)).map((e) =>
      e.type === 'node' && e.id === 101 ? ({ ...e, lon: 6.0305 } as OverpassElement) : e,
    );
    const bilan = await chargerOsm(client, trierElements({ elements: deplace }));
    expect(bilan.feux).toEqual({ presents: 7, nouveaux: 0, disparus: 1 });

    const { rows: feux } = await client.query(
      'SELECT osm_id::int, carrefour_id, present_osm, round(ST_X(geom)::numeric, 4)::float8 AS lon FROM feu WHERE osm_id IN (101, 105) ORDER BY osm_id',
    );
    expect(feux).toEqual([
      { osm_id: 101, carrefour_id: rows[0].id, present_osm: true, lon: 6.0305 },
      { osm_id: 105, carrefour_id: rows[0].id, present_osm: false, lon: 6.0303 },
    ]);
  });

  it('should update the OSM position of a signal placed by hand without moving it', async () => {
    await client.query(`
      UPDATE feu SET geom = ST_SetSRID(ST_MakePoint(6.031, 47.25), 4326), position_manuelle = true WHERE osm_id = 102
    `);
    const deplace = ELEMENTS_OSM.map((e) => (e.type === 'node' && e.id === 102 ? ({ ...e, lon: 6.0307 } as OverpassElement) : e));
    await chargerOsm(client, trierElements({ elements: deplace }));

    const { rows } = await client.query(`
      SELECT round(ST_X(geom)::numeric, 4)::float8 AS lon, round(ST_X(geom_osm)::numeric, 4)::float8 AS lon_osm
      FROM feu WHERE osm_id = 102
    `);
    expect(rows).toEqual([{ lon: 6.031, lon_osm: 6.0307 }]);
  });
});
