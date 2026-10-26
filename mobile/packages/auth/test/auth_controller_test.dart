// Needs a running backend:  API_URL=http://localhost:3000 dart test
import 'dart:io';
import 'dart:math';

import 'package:auth/auth.dart';
import 'package:core/core.dart';
import 'package:test/test.dart';

final baseUrl = Platform.environment['API_URL'];
String randomPhone() =>
    '9${List.generate(9, (_) => Random().nextInt(10)).join()}';

void main() {
  final skip = baseUrl == null ? 'Set API_URL to run' : false;

  AuthController make(TokenStore store, {String? url}) =>
      AuthController(baseUrl: url ?? baseUrl!, store: store);

  test('no saved token -> signedOut', () async {
    final c = make(MemoryTokenStore());
    expect(c.status, AuthStatus.unknown);
    await c.bootstrap();
    expect(c.status, AuthStatus.signedOut);
    await c.dispose();
  }, skip: skip);

  test('OTP sign-in persists the token; a new controller restores the session',
      () async {
    final store = MemoryTokenStore();
    final c = make(store);
    final states = <AuthStatus>[];
    c.changes.listen(states.add);
    await c.bootstrap();

    final phone = randomPhone();
    await c.sendOtp(phone);
    await expectLater(
        c.verifyOtp(phone, '999999'), throwsA(isA<ApiException>()));
    expect(
        c.status, AuthStatus.signedOut); // a wrong OTP must not sign anyone in
    final user = await c.verifyOtp(phone, '123456');
    expect((c.status, user.phone, await store.read() != null),
        (AuthStatus.signedIn, phone, true));

    final restored = make(store);
    await restored.bootstrap();
    expect(
        (restored.status, restored.user?.id), (AuthStatus.signedIn, user.id));
    expect((await restored.api.auth.profile()).phone,
        phone); // api carries the token

    await Future<void>.delayed(Duration.zero);
    expect(states, [AuthStatus.signedOut, AuthStatus.signedIn]);
    await c.dispose();
    await restored.dispose();
  }, skip: skip);

  test('signOut revokes the token on the server and clears the store',
      () async {
    final store = MemoryTokenStore();
    final c = make(store);
    final phone = randomPhone();
    await c.sendOtp(phone);
    await c.verifyOtp(phone, '123456');
    final token = (await store.read())!;

    await c.signOut();
    expect((c.status, c.user, await store.read()),
        (AuthStatus.signedOut, null, null));
    final old = Api(baseUrl: baseUrl!, tokenProvider: () => token);
    await expectLater(
        old.auth.me(),
        throwsA(
            isA<ApiException>().having((e) => e.isUnauthorized, '401', true)));
    await c.dispose();
  }, skip: skip);

  test('a stale stored token is discarded on bootstrap', () async {
    final store = MemoryTokenStore('not-a-real-token');
    final c = make(store);
    await c.bootstrap();
    expect((c.status, await store.read()), (AuthStatus.signedOut, null));
    await c.dispose();
  }, skip: skip);

  test('a token revoked mid-session signs the user out on the next call',
      () async {
    final store = MemoryTokenStore();
    final c = make(store);
    final phone = randomPhone();
    await c.sendOtp(phone);
    await c.verifyOtp(phone, '123456');
    final token = (await store.read())!;

    await Api(baseUrl: baseUrl!, tokenProvider: () => token)
        .auth
        .logout(); // revoked elsewhere
    final changed = c.changes.firstWhere((s) => s == AuthStatus.signedOut);
    await expectLater(c.api.auth.me(), throwsA(isA<ApiException>()));
    await changed.timeout(const Duration(seconds: 2));
    expect(await store.read(), isNull);
    await c.dispose();
  }, skip: skip);

  test(
      'offline at startup keeps the token and the unknown state, so the app can retry',
      () async {
    final store = MemoryTokenStore('some-token');
    final c = make(store, url: 'http://127.0.0.1:1'); // nothing listens here
    await expectLater(
        c.bootstrap(),
        throwsA(
            isA<ApiException>().having((e) => e.isNetwork, 'isNetwork', true)));
    expect((c.status, await store.read()), (AuthStatus.unknown, 'some-token'));
    await c.dispose();
  });

  test('role refresh after registering as a doctor', () async {
    final c = make(MemoryTokenStore());
    final phone = randomPhone();
    await c.sendOtp(phone);
    expect((await c.verifyOtp(phone, '123456')).role, Role.user);
    await c.api.doctors.register(
      hprId: '71${List.generate(12, (_) => Random().nextInt(10)).join()}',
      medicalStream: MedicalStream.mbbs,
      specialization: 'GP',
      feePaise: 30000,
    );
    expect(c.user!.role, Role.user); // stale until refreshed
    expect((await c.refreshUser()).role, Role.doctor);
    await c.dispose();
  }, skip: skip);
}
