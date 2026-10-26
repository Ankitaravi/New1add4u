# 1ADD4U mobile — API layer

```
mobile/
  packages/core/             # the app's ApiClient (+3 small additions) and the typed API layer
    lib/core.dart            #   package:core/core.dart  -> ApiClient, ApiException, TokenProvider (as before)
    lib/api.dart             #   package:core/api.dart   -> models, enums, money helpers, one service per backend module
  contract_tests/            # runs the app's real AuthController against the live backend
  api_client.diff            # exactly what changed in the app's api_client.dart
  MERGE.md                   # step-by-step: how to bring this into the real Flutter monorepo
```

`package:core/api.dart` is a **separate library** from `core.dart` so its model names (`Price`,
`Appointment`, `SlotDay` …) never clash with the app's existing ones — import it with a prefix and
migrate screens one at a time.

## Auth contract (backend ⇄ AuthController)

| Call | Body | Response |
|---|---|---|
| `POST /auth/otp/request` | `{phone}` | `{challengeId, expiresInSeconds}` |
| `POST /auth/otp/verify` | `{challengeId, phone, code}` | `{accessToken, refreshToken, expiresInSeconds, user, adminApprovalRequired}` |
| `POST /auth/refresh` | `{refreshToken}` | `{accessToken, refreshToken, expiresInSeconds}` |
| `POST /auth/logout` | `{refreshToken}` | `{ok}` (ends the whole session) |
| `GET /auth/me` | — | the user |

Access tokens last 15 minutes, refresh tokens 30 days and are rotated on every use. Presenting an
already-rotated refresh token revokes the whole session (theft detection). A challenge locks after
5 wrong codes; 5 OTP requests per phone per hour.

## Using the typed services

```dart
import 'package:core/core.dart';
import 'package:core/api.dart' as v2;

final client = ApiClient(baseUrl: const String.fromEnvironment('API_URL'))..tokens = authController;
final api = v2.Api(client);                         // shares the client's token refresh + retry

final slots = await api.appointments.slots(doctorId, DateTime(2026, 11, 2));
final appt  = await api.appointments.book(doctorId: doctorId, date: day, slot: '09:00'); // holds 10 min
final order = await api.payments.createOrder(v2.PaymentPurpose.appointment, appt.id);
// Razorpay Checkout with order.keyId / orderId / amountPaise, then:
await api.payments.verify(orderId: o, paymentId: p, signature: s);
```

The server also confirms payments by webhook, so a booking is confirmed even if the app dies
after paying. Lab bookings, pharma orders and home visits use the same flow
(`api.labs.pay`, `api.pharma.pay`, `api.staff.pay`).

Errors are `ApiException` (`statusCode`, `message`, plus `isConflict` / `isNotFound` /
`isForbidden` / `isUnauthorized`). AI endpoints return 503 when the server has no AI key and 429
past the hourly limit.

Push: after sign-in and on every FCM token refresh call
`api.notifications.registerDevice(token, platform: 'android')`; on sign-out `unregisterDevice`.

## Tests

```bash
cd packages/core && dart test test/unit_test.dart            # offline
# with the backend running in non-production mode and seeded (see ../backend):
API_URL=http://localhost:3000 dart test                      # in packages/core and contract_tests
```
