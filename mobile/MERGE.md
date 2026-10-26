# Merging into the real Flutter monorepo

You only need to touch `packages/core`. **Your `AuthController` and `TokenStore` need no changes** —
the backend now speaks the contract they already use (`contract_tests/` proves it by running your
unmodified `auth_controller.dart`).

1. **Copy new files** into `packages/core/lib/`:
   - `lib/api.dart`
   - `lib/src/api/` (whole folder)
2. **Apply the 3 edits to `lib/src/api_client.dart`**: `git apply api_client.diff` from the repo
   root, or copy the file over if you have not changed yours since sharing it:
   - `ApiException` gets `status`, `isUnauthorized/isForbidden/isNotFound/isConflict` getters.
   - `get()` takes an optional `query:` map (null values are dropped).
   - **Bug fix:** an error response with an empty body now says `Request failed` instead of an
     empty message.
3. **Leave `lib/core.dart` as it is** (it must keep exporting your existing models). Do *not*
   export `api.dart` from it.
4. `packages/core/pubspec.yaml` needs nothing new (`http` is already used). Dev-only, for the
   integration tests: `crypto`, `test`, `lints`.
5. **In the apps**, import the new layer with a prefix and migrate one screen at a time:
   `import 'package:core/api.dart' as v2;` → `final api = v2.Api(apiClient);`
6. Optional: copy `packages/core/test/` and `contract_tests/` to keep the tests.

## Things to know

- **`required this._api` needs Dart ≥ 3.12.** Your `AuthController` already uses it, so make sure
  every pubspec says `sdk: ^3.12.0` (the contract test package does).
- `ApiClient.post` defaults to `auth: false` (so login calls work). The typed services always send
  the token, so you never pass `auth:` yourself.
- `restore()` reports `signedOut` when the phone is offline at launch (the saved token is kept, so
  the next launch restores it). If you would rather keep an "unknown/retry" state, that is a
  change in `AuthController.restore()` — not made here.
- `AppointmentStatus` has **`inQueue`** (the backend uses IN_QUEUE) and unknown values parse to
  `unknown`.
- Platform admins: the backend returns `adminApprovalRequired: false` always. The 3-of-3 approval
  flow referenced in your controller is not implemented on this backend.
