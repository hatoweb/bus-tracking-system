const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

async function inspectParadasTables() {
  const poolCID = new Pool({
    host: process.env.DB_CID_HOST,
    port: parseInt(process.env.DB_CID_PORT || '5432'),
    user: process.env.DB_CID_USER,
    password: process.env.DB_CID_PASSWORD,
    database: process.env.DB_CID_NAME,
    ssl: process.env.DB_CID_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });

  try {
    console.log('--- PRUEBA JOIN DE PARADAS OFICIALES PARA EMPRESA (cod_catalogo = 5, SAN ISIDRO SRL) ---');
    const paradasRes = await poolCID.query(`
      SELECT 
        e.eot_id,
        e.eot_nombre,
        r.linea,
        h.id_itinerario,
        h.ruta_hex,
        ip.orden,
        p.id as id_parada,
        p.source_id,
        p.source_name,
        p.attrs,
        ST_SRID(p.geom) as srid,
        ST_Y(ST_Transform(p.geom, 4326)) as latitud,
        ST_X(ST_Transform(p.geom, 4326)) as longitud
      FROM public.eots e
      JOIN public.catalogo_rutas r ON r.id_eot_catalogo = e.cod_catalogo
      JOIN geometria.historico_itinerario h ON LOWER(h.ruta_hex) = LOWER(r.ruta_hex)
      JOIN geometria.itinerario_parada ip ON ip.id_itinerario = h.id_itinerario
      JOIN geometria.paradas_oficiales p ON p.id = ip.id_parada
      WHERE e.cod_catalogo = 5
        AND h.fecha_inicio_vigencia IS NOT NULL
        AND h.fecha_inicio_vigencia <= CURRENT_DATE
        AND (h.fecha_fin_vigencia IS NULL OR h.fecha_fin_vigencia >= CURRENT_DATE)
      ORDER BY h.id_itinerario, ip.orden ASC
      LIMIT 10;
    `);
    console.table(paradasRes.rows);
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await poolCID.end();
  }
}

inspectParadasTables();
