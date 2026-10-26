/// In-memory stand-in for the app's `TokenStore` (the real one wraps secure storage). The
/// surface is exactly what `auth_controller.dart` calls: `TokenStore()`, `save`,
/// `accessToken`, `readRefreshToken`, `clear`.
class TokenStore {
  String? _access;
  String? _refresh;

  String? get accessToken => _access;
  Future<String?> readRefreshToken() async => _refresh;

  Future<void> save({required String accessToken, required String refreshToken}) async {
    _access = accessToken;
    _refresh = refreshToken;
  }

  Future<void> clear() async {
    _access = null;
    _refresh = null;
  }

  // Test hooks.
  set debugAccessToken(String? t) => _access = t;
  set debugRefreshToken(String? t) => _refresh = t;
}
