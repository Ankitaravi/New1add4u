// The app's real AuthController + ApiClient against the live backend.
//   API_URL=http://localhost:3000 dart test
import 'dart:io';
import 'dart:math';

import 'package:auth_contract_tests/auth_controller.dart';
import 'package:auth_contract_tests/token_store.dart';
import 'package:core/core.dart';
import 'package:test/test.dart';

final baseUrl = Platform.environment['API_URL'];
String randomPhone() =>
    '9${List.generate(9, (_) => Random().nextInt(10)).join()}';

class Session {
  Session(this.store) {
    api = ApiClient(baseUrl: baseUrl!);
    auth = AuthController(api: api, store: store);
  }
  final TokenStore store;
  late final ApiClient api;
  late final AuthController auth;

  Future<String> loginAs(String phone) async {
    final ch = await auth.requestOtp(phone);
    await auth.verifyOtp(ch, '123456');
    return phone;
  }

  Future<String?> whoAmI() async =>
      (await api.get('/auth/me'))?['phone'] as String?;
}

void main() {
  final skip = baseUrl == null ? 'Set API_URL to run' : false;

  test(
    'requestOtp returns a challenge; bad phone is a 400 ApiException',
    () async {
      final s = Session(TokenStore());
      final ch = await s.auth.requestOtp(randomPhone());
      expect(ch.challengeId, isNotEmpty);
      expect(ch.expiresInSeconds, 300);
      await expectLater(
        s.auth.requestOtp('123'),
        throwsA(isA<ApiException>().having((e) => e.statusCode, 'status', 400)),
      );
    },
    skip: skip,
  );

  test(
    'verifyOtp: wrong code is 401 and signs nobody in; right code stores both tokens',
    () async {
      final s = Session(TokenStore());
      final phone = randomPhone();
      final ch = await s.auth.requestOtp(phone);
      await expectLater(
        s.auth.verifyOtp(ch, '000000'),
        throwsA(isA<ApiException>().having((e) => e.statusCode, 'status', 401)),
      );
      expect(s.auth.status, AuthStatus.unknown);

      await s.auth.verifyOtp(ch, '123456');
      expect(s.auth.status, AuthStatus.signedIn);
      expect(s.store.accessToken, isNotEmpty);
      expect(await s.store.readRefreshToken(), isNotEmpty);
      expect(await s.whoAmI(), phone);
    },
    skip: skip,
  );

  test(
    'restore(): a saved refresh token keeps the user logged in, and is rotated',
    () async {
      final first = Session(TokenStore());
      final phone = await first.loginAs(randomPhone());
      final saved = await first.store.readRefreshToken();

      final restarted = Session(
        first.store,
      ); // new app process, same secure storage
      await restarted.auth.restore();
      expect(restarted.auth.status, AuthStatus.signedIn);
      expect(await restarted.store.readRefreshToken(), isNot(saved));
      expect(await restarted.whoAmI(), phone);
    },
    skip: skip,
  );

  test(
    'an expired access token is renewed transparently and the request retried',
    () async {
      final s = Session(TokenStore());
      final phone = await s.loginAs(randomPhone());
      final refreshBefore = await s.store.readRefreshToken();

      s.store.debugAccessToken = 'expired-or-garbage';
      expect(await s.whoAmI(), phone);
      expect(await s.store.readRefreshToken(), isNot(refreshBefore));
      expect(s.auth.status, AuthStatus.signedIn);
    },
    skip: skip,
  );

  test(
    'parallel 401s share ONE refresh, so the session survives (no false theft detection)',
    () async {
      final s = Session(TokenStore());
      final phone = await s.loginAs(randomPhone());
      s.store.debugAccessToken = 'expired-or-garbage';

      final results = await Future.wait(List.generate(6, (_) => s.whoAmI()));
      expect(results, everyElement(phone));
      expect(s.auth.status, AuthStatus.signedIn);
      expect(await s.whoAmI(), phone); // still alive afterwards
    },
    skip: skip,
  );

  test(
    'a replayed (already rotated) refresh token ends the session on the server and in the app',
    () async {
      final s = Session(TokenStore());
      await s.loginAs(randomPhone());
      final stolen = (await s.store.readRefreshToken())!;
      s.store.debugAccessToken = 'garbage';
      await s.whoAmI(); // legitimate refresh rotates the token

      final thief = Session(TokenStore()..debugRefreshToken = stolen);
      await thief.auth.restore();
      expect(thief.auth.status, AuthStatus.signedOut);
      expect(await thief.store.readRefreshToken(), isNull);

      // the real user's newest token is revoked as well: whole family killed
      s.store.debugAccessToken = 'garbage';
      await expectLater(
        s.whoAmI(),
        throwsA(isA<ApiException>().having((e) => e.statusCode, 'status', 401)),
      );
      expect(s.auth.status, AuthStatus.signedOut);
    },
    skip: skip,
  );

  test('logout ends the session server-side and clears local state', () async {
    final s = Session(TokenStore());
    await s.loginAs(randomPhone());
    final access = s.store.accessToken!;
    final refresh = (await s.store.readRefreshToken())!;

    await s.auth.logout();
    expect(s.auth.status, AuthStatus.signedOut);
    expect(
      (s.store.accessToken, await s.store.readRefreshToken()),
      (null, null),
    );

    final raw = ApiClient(baseUrl: baseUrl!);
    await expectLater(
      raw.post('/auth/refresh', body: {'refreshToken': refresh}),
      throwsA(isA<ApiException>()),
    );
    final other = Session(TokenStore()..debugRefreshToken = null);
    other.store.debugAccessToken = access;
    await expectLater(
      other.whoAmI(),
      throwsA(isA<ApiException>().having((e) => e.statusCode, 'status', 401)),
    );
  }, skip: skip);

  test('restore() with no saved session is signedOut', () async {
    final s = Session(TokenStore());
    await s.auth.restore();
    expect(s.auth.status, AuthStatus.signedOut);
  }, skip: skip);
}
