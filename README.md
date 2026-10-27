# Prueba técnica Lumni: reservas de salas

Aplicación para cotizar salas de coworking. La primera entrega cubre la Parte 1.1: API de cotización, reglas de horario, consulta de disponibilidad y pantalla web.

## Requisitos

- Node.js 20.19 o superior, o 22.12 o superior, y npm.
- Docker Desktop con el motor iniciado.

## Ejecución local

Si todavía no existe el archivo `.env`, créalo desde el ejemplo:

```powershell
Copy-Item .env.example .env
```

Luego ejecuta desde la raíz del proyecto:

```powershell
docker compose up -d db
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

La pantalla queda en <http://localhost:5173> y la API en <http://localhost:3001>. PostgreSQL se publica en el puerto `5433` para no interferir con instalaciones locales que usen el puerto predeterminado `5432`.

Para detener PostgreSQL sin borrar sus datos:

```powershell
docker compose stop db
```

Las credenciales de desarrollo están en `.env.example`; `.env` está excluido de Git. En otro entorno, cambia `DATABASE_URL` por la conexión correspondiente.

## API de cotización

`GET /api/rooms` devuelve las salas disponibles y su tarifa por hora.

`POST /api/quotes` recibe una sala, fecha, hora de inicio y duración:

```json
{
  "roomId": 2,
  "date": "2026-10-28",
  "startTime": "09:00",
  "durationHours": 4
}
```

La respuesta incluye la sala, el horario, el desglose (`base`, `discount`, `surcharge`, `total`), `available`, el motivo cuando no se puede reservar y `suggestedStartTime` cuando existe un horario posterior libre ese día.

## Reglas implementadas

- Tarifas: sala pequeña `$40.000`, mediana `$70.000` y grande `$120.000` COP por hora. La tarifa usada se consulta desde PostgreSQL.
- Duración de 1 a 10 horas, en intervalos de 30 minutos.
- Horario de lunes a sábado, de 07:00 a 21:00; el domingo está cerrado. Las fechas y horas se interpretan en la zona de Bogotá (`UTC-05:00`).
- Descuento del 10 % desde 4 horas y del 20 % desde 8 horas. El sábado se suma el 25 % después del descuento.
- Solo las reservas `confirmed` bloquean disponibilidad. Los intervalos son semiabiertos: una reserva que termina a las 10:00 no se cruza con otra que empieza a esa hora.
- La migración incluye una restricción de exclusión GiST para impedir cruces entre reservas confirmadas de la misma sala, incluso ante confirmaciones simultáneas. El flujo de confirmación pertenece a la Parte 1.2 y aún no está implementado.

El cotizador no crea ni aparta reservas: una cotización disponible puede cambiar si otra persona confirma antes.

## Verificaciones

```powershell
npm test
npm run lint
npm run build
```

Las pruebas unitarias cubren tarifas, descuentos, recargo de sábado, duración, horario, domingo, zona horaria, disponibilidad y sugerencia de horario.

## Decisiones y alcance pendiente

Las reglas de precio y horario viven en funciones puras para probarse sin una base de datos. El servicio de cotización recibe un repositorio: en producción consulta PostgreSQL y en las pruebas usa un repositorio en memoria. Las fechas se reciben como fecha local de Bogotá y se convierten a `timestamptz` para comparar intervalos.

Esta entrega todavía no incluye borradores de reserva, autenticación, pagos, panel de administración, servicios adicionales ni las integraciones de las Partes 2, 3 y 4. Se agregarán sobre este mismo proyecto en commits separados.

## Uso de IA

Se utilizó GitHub Copilot para apoyar el scaffold, la implementación de la pantalla/API y las pruebas. Se ajustó la propuesta inicial para que el cálculo use la tarifa consultada desde PostgreSQL, en lugar de duplicar el precio dentro del formulario. Se verificaron build, lint, las pruebas unitarias y solicitudes reales al API con PostgreSQL; también se probó una franja ocupada y se eliminó el registro temporal de prueba.