# Prueba técnica Lumni: reservas de salas

Aplicación para cotizar y reservar salas de coworking. Las Partes 1.1, 1.2, 1.3, 2.1 y 2.2 cubren el cotizador, el wizard retomable, la administración, el correo asíncrono y el asistente con modelo local OpenAI-compatible.

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

### Modelo local

El backend usa el SDK OpenAI con `baseURL` configurable, compatible con llama.cpp. Antes de iniciar la app, ajusta en `.env`:

```dotenv
AI_BASE_URL=http://localhost:11434/v1
AI_API_KEY=local-llama
AI_MODEL=local-model
AI_TIMEOUT_MS=120000
```

`AI_MODEL` debe coincidir con uno de los `id` que devuelve `GET /v1/models`. La clave `local-llama` es un placeholder para servidores locales sin autenticación; reemplázala si tu servidor requiere una clave. La URL, el modelo, la clave y el timeout se pueden cambiar sin editar el código.

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

## Reserva por pasos

El wizard guarda cliente, sala/horario y servicios en un borrador de PostgreSQL. El navegador conserva en `localStorage` el identificador del borrador y un token aleatorio de acceso para permitir retomarlo después de recargar o cerrar la página. El servidor guarda solo el hash SHA-256 del token. Las rutas privadas requieren `Authorization: Bearer <token>`.

- `POST /api/bookings/drafts`: crea un borrador a partir de una cotización disponible y devuelve la reserva junto con el token, que solo se muestra al crearlo.
- `GET /api/bookings/:id`: recupera el borrador asociado al token.
- `PATCH /api/bookings/:id/customer`: guarda los datos del cliente.
- `PATCH /api/bookings/:id/step`: persiste el avance permitido del wizard; no permite saltar al paso de servicios.
- `PATCH /api/bookings/:id/schedule`: vuelve a consultar el cotizador y guarda la sala, el horario y el precio pactado.
- `PATCH /api/bookings/:id/services`: guarda el proyector y la cantidad de cafés, y actualiza el desglose.
- `POST /api/bookings/:id/confirm`: confirma desde el botón de la app; el chat u otros clientes nunca confirman por el usuario.

Decisión de precio para servicios, no especificada en la guía: el proyector cuesta `$50.000` COP y el café `$8.000` COP por persona.

## Acceso y administración

`npm run db:seed` crea estas cuentas locales de demostración:

| Rol | Correo | Contraseña |
| --- | --- | --- |
| Cliente | `cliente@lumni.local` | `Cliente-demo-2026!` |
| Administrador | `admin@lumni.local` | `Admin-demo-2026!` |

Son credenciales públicas para desarrollo; no se deben reutilizar en producción. Las contraseñas se guardan con `scrypt`. El login entrega un token aleatorio de sesión con duración de 8 horas; PostgreSQL conserva su hash, y logout revoca la sesión.

El usuario administrador puede consultar `/api/admin/bookings` con filtro por estado y sala, paginación (`pageSize` máximo 50), y abrir `/api/admin/bookings/:id` para el detalle. `POST /api/admin/bookings/:id/cancel` exige un motivo de 1 a 500 caracteres y registra motivo y fecha. El servidor valida el rol; un cliente autenticado recibe `403`.

## Correo de confirmación (Parte 2.1)

La primera transición de una reserva a `confirmed` inserta un job en `booking_email_jobs` dentro de la misma transacción. La API no espera al worker. Un índice único por reserva evita jobs duplicados y el claim usa `FOR UPDATE SKIP LOCKED` para que dos procesos no tomen el mismo job.

El worker captura el correo en `captured_emails`, por lo que los envíos se pueden inspeccionar localmente sin proveedor externo. Si falla, reintenta con esperas de 1, 2, 4, 8 y 16 segundos: cinco reintentos después del envío inicial, seis intentos en total. Tras el sexto fallo queda `failed`; se guarda el último error. Los jobs `processing` con más de cinco minutos sin lock se recuperan al iniciar y periódicamente.

En el panel de administración, la pestaña **Correos** permite filtrar por `pending`, `processing`, `sent` y `failed`, revisar intentos, error, contenido y fecha de captura. Las rutas `GET /api/admin/emails` y `GET /api/admin/emails/:id` requieren rol administrador.

## Asistente de reservas con IA (Parte 2.2)

El botón **Asistente** abre un chat retomable. El prompt está en `server/prompts/reservation-assistant.md`; el modelo recibe el catálogo de salas y el mensaje actual, y debe devolver JSON que se valida con un schema estricto. El servidor comprueba que cada fragmento extraído aparezca en el texto del usuario y resuelve fechas en español en código con `chrono-node` y la zona de Bogotá.

El modelo nunca calcula precio ni disponibilidad: cuando los datos obligatorios están explícitos, el servidor llama a `POST /api/quotes`. Si no hay cupo, el servidor muestra la sugerencia y solo la usa después de una aceptación explícita. Al completar los datos, se crea un borrador con el cliente, asistentes, proyector y café; el chat no confirma ni cancela. La confirmación ocurre en el wizard normal.

`POST /api/assistant/chats` crea una conversación y devuelve su token aleatorio. `GET /api/assistant/chats/:id` y `POST /api/assistant/chats/:id/messages` requieren `Authorization: Bearer <token>`. PostgreSQL guarda únicamente el hash del token y expira el chat después de 30 días. El navegador guarda el token para reanudarlo; no se envían al modelo mensajes de otros clientes, credenciales ni datos de reservas existentes.

La respuesta del modelo se valida con Zod en modo estricto y el prompt no tiene herramientas ni acceso a datos de otros clientes. El extractor solo aporta fragmentos que deben aparecer literalmente en el mensaje actual; el servidor resuelve fechas en español y no usa una hora sugerida hasta recibir un “sí” explícito. Cuando falta un dato, el asistente pregunta. Precio y disponibilidad siempre vienen de `POST /api/quotes`; al completar lo explícito crea un borrador, pero solo el wizard puede confirmarlo.

Para probar la configuración actual del equipo, `AI_MODEL` en el `.env` local está ajustado al identificador publicado por tu servidor llama.cpp. En otra máquina, reemplázalo por un `id` de `GET /v1/models`. En el repositorio, `.env.example` usa `local-model` como placeholder portable.

## Reglas implementadas

- Tarifas: sala pequeña `$40.000`, mediana `$70.000` y grande `$120.000` COP por hora. La tarifa usada se consulta desde PostgreSQL.
- Duración de 1 a 10 horas, en intervalos de 30 minutos.
- Horario de lunes a sábado, de 07:00 a 21:00; el domingo está cerrado. Las fechas y horas se interpretan en la zona de Bogotá (`UTC-05:00`).
- Descuento del 10 % desde 4 horas y del 20 % desde 8 horas. El sábado se suma el 25 % después del descuento.
- Solo las reservas `confirmed` bloquean disponibilidad. Los intervalos son semiabiertos: una reserva que termina a las 10:00 no se cruza con otra que empieza a esa hora.
- Una restricción de exclusión GiST impide cruces entre reservas confirmadas de la misma sala. La confirmación además bloquea la fila del borrador con `FOR UPDATE`; si otra transacción ganó el horario, PostgreSQL rechaza el cambio y el API responde `409`.
- Repetir la confirmación de una reserva ya confirmada es idempotente: la transición no vuelve a modificar el estado y el total se lee del valor pactado, sin recalcularse.

El cotizador no crea ni aparta reservas: una cotización disponible puede cambiar si otra persona confirma antes.

## Verificaciones

```powershell
npm test
npm run lint
npm run build
```

Las pruebas unitarias cubren tarifas, descuentos, recargo de sábado, duración, horario, domingo, zona horaria, disponibilidad, extracción validada, fechas relativas, sugerencias aceptadas explícitamente, transiciones de estado, totales de servicios, hash de contraseñas y backoff/límite de reintentos.

## Decisiones y alcance pendiente

Las reglas de precio y horario viven en funciones puras para probarse sin una base de datos. El servicio de cotización recibe un repositorio: en producción consulta PostgreSQL y en las pruebas usa un repositorio en memoria. Las fechas se reciben como fecha local de Bogotá y se convierten a `timestamptz` para comparar intervalos. Los borradores se autorizan con un token aleatorio; la confirmación usa una transacción y una restricción de base de datos para resolver carreras.

El token de borrador, la sesión de usuario y el token del chat son credenciales distintas. La cuenta demo permite probar el flujo local, pero no sustituye secretos, políticas de contraseña ni configuración de sesiones de producción. No se incluyen pagos ni las Partes 3 y 4.

## Uso de IA

Se utilizó GitHub Copilot para apoyar el scaffold, el cotizador, el wizard, la administración, el worker de correo, el asistente y las pruebas. Se verificaron build, lint, pruebas unitarias y flujos reales con PostgreSQL y llama.cpp local: extracción de datos, resolución de “el sábado”, cotización por backend, creación de borrador y reanudación tras recargar con el mismo subtotal. También se probó que el borrador conserva servicios y que el chat no confirma reservas. Los registros temporales se eliminaron.