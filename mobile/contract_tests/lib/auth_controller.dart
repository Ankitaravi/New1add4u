import 'dart:async';

import 'package:core/core.dart';
import 'package:flutter/foundation.dart';

import 'token_store.dart';

enum AuthStatus { unknown, signedOut, signedIn }

/// Result of asking for an OTP: needed to verify the code.
class OtpChallenge {
  const OtpChallenge({required this.challengeId, required this.phone, required this.expiresInSeconds});

  final String challengeId;
  final String phone;
  final int expiresInSeconds;
}

/// Login state for the whole app. Screens listen to [status].
class AuthController extends ChangeNotifier implements TokenProvider {
  AuthController({required this._api, TokenStore? store}) : _store = store ?? TokenStore() {
    _api.tokens = this;
  }

  final ApiClient _api;
  final TokenStore _store;
  AuthStatus _status = AuthStatus.unknown;
  Future<bool>? _refreshing;

  AuthStatus get status => _status;

  /// On app start: a saved refresh token keeps the user logged in.
  Future<void> restore() async {
    final ok = await refresh();
    _setStatus(ok ? AuthStatus.signedIn : AuthStatus.signedOut);
  }

  /// [phone] is the 10-digit mobile number.
  Future<OtpChallenge> requestOtp(String phone) async {
    final res = await _api.post('/auth/otp/request', body: {'phone': phone});
    return OtpChallenge(
      challengeId: res?['challengeId'] as String,
      phone: phone,
      expiresInSeconds: (res?['expiresInSeconds'] as num?)?.toInt() ?? 300,
    );
  }

  Future<void> verifyOtp(OtpChallenge challenge, String code) async {
    final res = await _api.post(
      '/auth/otp/verify',
      body: {'challengeId': challenge.challengeId, 'phone': challenge.phone, 'code': code},
    );
    if (res == null || res['adminApprovalRequired'] == true) {
      // Platform admins log in only through the 3-of-3 approval flow, never from a public app.
      throw ApiException(403, 'This account cannot sign in here');
    }
    await _store.save(accessToken: res['accessToken'] as String, refreshToken: res['refreshToken'] as String);
    _setStatus(AuthStatus.signedIn);
  }

  Future<void> logout() async {
    final refreshToken = await _store.readRefreshToken();
    if (refreshToken != null) {
      try {
        await _api.post('/auth/logout', body: {'refreshToken': refreshToken});
      } on Exception {
        // Best effort: the local session is cleared below even when offline.
      }
    }
    await _store.clear();
    _setStatus(AuthStatus.signedOut);
  }

  @override
  Future<String?> accessToken() async => _store.accessToken;

  @override
  Future<bool> refresh() {
    // Parallel 401s share one refresh. Sending the same refresh token twice would
    // look like token theft to the backend, and it would end the whole session.
    return _refreshing ??= _doRefresh().whenComplete(() => _refreshing = null);
  }

  Future<bool> _doRefresh() async {
    final refreshToken = await _store.readRefreshToken();
    if (refreshToken == null) return false;
    try {
      final res = await _api.post('/auth/refresh', body: {'refreshToken': refreshToken});
      await _store.save(accessToken: res?['accessToken'] as String, refreshToken: res?['refreshToken'] as String);
      return true;
    } on ApiException catch (e) {
      if (e.statusCode == 401) {
        await _store.clear();
        _setStatus(AuthStatus.signedOut);
      }
      return false;
    } on Exception {
      // Network problem: keep the saved token and try again later.
      return false;
    }
  }

  void _setStatus(AuthStatus value) {
    if (_status == value) return;
    _status = value;
    notifyListeners();
  }
}