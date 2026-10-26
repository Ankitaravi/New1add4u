# 1ADD4U mobile packages

Pure-Dart packages that every Flutter app (`user_app`, `doctor_app`, `staff_app`, `pharma_app`,
`investigation_app`, `student_app`) depends on. They have **no Flutter dependency**, so they are
tested with plain `dart test` against the real backend.

| Package | What it is |
|---|---|
| `packages/core` | `ApiClient`, models, enums, money/HPR helpers, and one typed service per backend module |
| `packages/auth` | `AuthController` (`unknown` / `signedOut` / `signedIn`), OTP flow, `TokenStore` |

Put them in the monorepo's `packages/` folder and depend on them by path:

```yaml
dependencies:
  core: { path: ../../packages/core }
  auth: { path: ../../packages/auth }
```

## Using it in an app

```dart
// 1. Secure token storage (add flutter_secure_storage to the *app*, not the packages)
class SecureTokenStore implements TokenStore {
  final _s = const FlutterSecureStorage();
  @override Future<String?> read() => _s.read(key: 'token');
  @override Future<void> write(String t) => _s.write(key: 'token', value: t);
  @override Future<void> clear() => _s.delete(key: 'token');
}

// 2. One controller for the whole app
final auth = AuthController(baseUrl: const String.fromEnvironment('API_URL'), store: SecureTokenStore());
await auth.bootstrap();           // GET /auth/me; a rejected token -> signedOut

// 3. Gate the UI on it
StreamBuilder<AuthStatus>(stream: auth.changes, initialData: auth.status, builder: ...);

// 4. Call the API through auth.api so every request carries the token
final slots = await auth.api.appointments.slots(doctorId, DateTime(2026, 11, 2));
```

Build with `--dart-define=API_URL=https://api.yourdomain.com`. On Android emulators the host
machine is `http://10.0.2.2:3000`; on iOS simulators `http://localhost:3000`.

### Paying (Razorpay)

```dart
final appt  = await api.appointments.book(doctorId: id, date: day, slot: '09:00'); // holds 10 min
final order = await api.payments.createOrder(PaymentPurpose.appointment, appt.id);
// open Razorpay Checkout with order.keyId / order.orderId / order.amountPaise, then in its success callback:
await api.payments.verify(orderId: r.orderId, paymentId: r.paymentId, signature: r.signature);
```

The server also confirms via webhook, so if the app dies after paying, the booking is still
confirmed. Lab bookings, pharma orders and home visits use the same flow
(`api.labs.pay`, `api.pharma.pay`, `api.staff.pay`).

### Push notifications

After sign-in and on every FCM token refresh:
`api.notifications.registerDevice(token, platform: 'android')`; on sign-out call `unregisterDevice`.

### Errors

Every failure is an `ApiException` with `status` (0 = no network), `message` (already
user-readable, validation errors joined with newlines) and helpers `isConflict`, `isNotFound`,
`isForbidden`, `isUnauthorized`. A 401 on an authenticated call signs the user out automatically.
AI endpoints return 503 when the server has no AI key and 429 past the hourly limit.

## Differences from the old app models

- `AppointmentStatus` has **`inQueue`** (the backend has an IN_QUEUE state) and `cancelled`.
- Unknown enum values from a newer server parse to `unknown` instead of crashing.
- Prices come back as `Price { feePaise, mdrPaise, totalPaise }`; pharma orders expose
  `payable` (quoted subtotal + 2% MDR).

## Tests

```bash
cd packages/core && dart test test/unit_test.dart        # offline
# Needs the backend running in non-production mode with seed data (see backend/):
API_URL=http://localhost:3000 dart test                  # in packages/core and packages/auth
```
