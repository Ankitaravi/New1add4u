import 'dart:async';

import 'package:core/core.dart';
import 'package:http/http.dart' as http;

import 'token_store.dart';

enum AuthStatus { unknown, signedOut, signedIn }

/// The app's single source of truth for "who is signed in".
///
/// 1. [sendOtp] -> POST /auth/otp/send
/// 2. [verifyOtp] -> POST /auth/otp/verify, stores the token
/// 3. [bootstrap] on app start -> GET /auth/me to confirm the stored token is still valid
///
/// Listen to [changes] (e.g. with a `StreamBuilder`) or read [status] / [user].
class AuthController {
  AuthController(
      {required String baseUrl,
      required TokenStore store,
      http.Client? httpClient})
      : _store = store {
    api = Api(
      baseUrl: baseUrl,
      httpClient: httpClient,
      tokenProvider: () => _token,
      onUnauthorized: () => unawaited(_expire()),
    );
  }

  /// Use this for every API call so requests carry the session token.
  late final Api api;
  final TokenStore _store;
  final _changes = StreamController<AuthStatus>.broadcast();

  String? _token;
  User? _user;
  AuthStatus _status = AuthStatus.unknown;

  AuthStatus get status => _status;
  User? get user => _user;
  Stream<AuthStatus> get changes => _changes.stream;

  void _set(AuthStatus s) {
    if (_status == s) return;
    _status = s;
    _changes.add(s);
  }

  /// Call once at startup. A rejected token signs the user out; a network failure leaves the
  /// status `unknown` (token kept) and rethrows so the app can offer a retry.
  Future<void> bootstrap() async {
    final saved = await _store.read();
    if (saved == null) return _set(AuthStatus.signedOut);
    _token = saved;
    try {
      _user = await api.auth.me();
      _set(AuthStatus.signedIn);
    } on ApiException catch (e) {
      if (e.isUnauthorized) {
        await _clear();
      } else {
        rethrow;
      }
    }
  }

  Future<void> sendOtp(String phone) => api.auth.sendOtp(phone);

  Future<User> verifyOtp(String phone, String otp) async {
    final r = await api.auth.verifyOtp(phone, otp);
    _token = r.token;
    _user = r.user;
    await _store.write(r.token);
    _set(AuthStatus.signedIn);
    return r.user;
  }

  /// Re-fetch the profile (e.g. after registering as a doctor changes the role).
  Future<User> refreshUser() async => _user = await api.auth.me();

  /// Revokes the token on the server (best effort) and clears it locally.
  Future<void> signOut() async {
    try {
      await api.auth.logout();
    } on ApiException {
      // Offline or already expired: signing out locally is still correct.
    }
    await _clear();
  }

  Future<void> _expire() async {
    if (_status == AuthStatus.signedIn) await _clear();
  }

  Future<void> _clear() async {
    _token = null;
    _user = null;
    await _store.clear();
    _set(AuthStatus.signedOut);
  }

  Future<void> dispose() async {
    api.client.close();
    await _changes.close();
  }
}
