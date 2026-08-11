# bus-tracking-system

Seguimiento de buses AMA (Asunción / Central): origen–destino, paradas oficiales, líneas/empresas y GPS en tiempo real.

Repo: https://github.com/hatoweb/bus-tracking-system/

## Puertos en 172.16.222.222

Según el mapeo institucional, este sistema usa:

| Servicio | Contenedor | Host | Interno | URL |
|----------|------------|------|---------|-----|
| Next.js | `bus_tracking_app` | **3009** | 3000 | http://172.16.222.222:3009 |
| geo-itinerarios (aparte) | — | **8020** | 8020 | http://172.16.222.222:8020 |

`3009` y `8020` no figuran ocupados (libres frente a 3002/3003/3008, 8010/8011, etc.).

## Desarrollo local

```bash
cp .env.local.example .env.local
# completar credenciales CID / GPS
npm install
npm run dev
```

En otra terminal, levantar `geo-itinerarios` en `:8020`.

## Despliegue en el servidor (Docker)

Requisitos: Docker + Docker Compose, acceso a las BDs CID/GPS, y `geo-itinerarios` en el host `:8020`.

```bash
cd /home/user
git clone https://github.com/hatoweb/bus-tracking-system.git
cd bus-tracking-system
cp .env.example .env
nano .env   # cargar host, usuario y contraseñas reales

ss -tulpn | grep -E ':3009|:8020'   # confirmar libres
docker compose up -d --build
docker compose logs -f
```

Abrir: http://172.16.222.222:3009

Actualizar:

```bash
cd /home/user/bus-tracking-system
git pull
docker compose up -d --build
```

`GEO_ITINERARIOS_URL` en el `.env` del contenedor debe ser `http://host.docker.internal:8020` si la API corre en el mismo servidor.

## Variables de entorno

Ver `.env.example`. No commitear `.env` ni `.env.local`.
