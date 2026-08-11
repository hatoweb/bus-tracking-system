-- Script de creación del esquema 'reclamos' para la base de datos BBDD_CID (bbdd-monitoreo-cid)

CREATE SCHEMA IF NOT EXISTS reclamos;

CREATE TABLE IF NOT EXISTS reclamos.tb_reclamos (
    id_reclamo SERIAL PRIMARY KEY,
    ticket_num VARCHAR(20) NOT NULL UNIQUE,
    usuario_email VARCHAR(150),
    usuario_nombre VARCHAR(150),
    tipo VARCHAR(50) NOT NULL, -- 'reclamo', 'sugerencia', 'consulta', 'reporte_bus'
    linea_empresa VARCHAR(100),
    mensaje TEXT NOT NULL,
    estado VARCHAR(30) DEFAULT 'pendiente', -- 'pendiente', 'en_proceso', 'resuelto'
    respuesta TEXT,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_respuesta TIMESTAMP
);

-- Datos iniciales de prueba para verificación
INSERT INTO reclamos.tb_reclamos (ticket_num, usuario_email, usuario_nombre, tipo, linea_empresa, mensaje, estado, respuesta, fecha_respuesta)
VALUES 
  ('VMT-849201', 'ciudadano@ejemplo.com', 'Juan Pérez', 'reclamo', 'Línea 12 - Magno SA', 'El bus no respetó la parada obligatoria en Av. Mariscal López.', 'resuelto', 'Se notificó a la empresa operadora Magno SA y se aplicó el sumario administrativo correspondiente.', CURRENT_TIMESTAMP - INTERVAL '2 hours'),
  ('VMT-102934', 'maria.gonzalez@gmail.com', 'María González', 'consulta', 'Línea 27', '¿Cuál es la frecuencia del servicio los días feriados por la mañana?', 'resuelto', 'Los feriados la frecuencia opera con intervalo de 20 minutos de 06:00 a 12:00 hs.', CURRENT_TIMESTAMP - INTERVAL '1 day')
ON CONFLICT (ticket_num) DO NOTHING;
