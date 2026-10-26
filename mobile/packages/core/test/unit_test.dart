import 'dart:convert';

import 'package:core/core.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:test/test.dart';

ApiClient clientFor(MockClient m,
        {String? token, void Function()? onUnauthorized}) =>
    ApiClient(
        baseUrl: 'http://api.test/',
        httpClient: m,
        tokenProvider: () => token,
        onUnauthorized: onUnauthorized);

void main() {
  group('money', () {
    test('MDR is 2%, rounded like the server', () {
      expect(Price.of(50000),
          const Price(feePaise: 50000, mdrPaise: 1000, totalPaise: 51000));
      expect(Price.of(35000).totalPaise, 35700);
      expect(Price.of(1).mdrPaise, 0);
      expect(Price.of(75).mdrPaise, 2); // 1.5 rounds up
    });
    test('rupees()', () {
      expect(rupees(2350), '₹23.50');
      expect(rupees(251000), '₹2510');
      expect(rupees(5), '₹0.05');
      expect(rupees(0), '₹0');
    });
    test('HPR id', () {
      expect(validHprId('71123456789012'), isTrue);
      expect(validHprId('71-1234-5678-9012'), isTrue);
      expect(validHprId('7112345678901'), isFalse);
      expect(validHprId('7112345678901a'), isFalse);
      expect(formatHprId('71123456789012'), '71-1234-5678-9012');
    });
    test('formatDay pads',
        () => expect(formatDay(DateTime(2026, 3, 5)), '2026-03-05'));
  });

  group('enums', () {
    test('round-trip wire values', () {
      for (final e in AppointmentStatus.values
          .where((e) => e != AppointmentStatus.unknown)) {
        expect(AppointmentStatus.parse(e.wire), e);
      }
      expect(OrderStatus.parse('quoted'), OrderStatus.quoted);
      expect(LabStatus.parse('REPORT_UPLOADED'), LabStatus.reportUploaded);
      expect(ServiceType.parse('ivDrip'), ServiceType.ivDrip);
      expect(LabTestType.parse('hba1c'), LabTestType.hba1c);
    });
    test('unknown server values never throw', () {
      expect(
          AppointmentStatus.parse('SOMETHING_NEW'), AppointmentStatus.unknown);
      expect(Role.parse(null), Role.unknown);
      expect(LabTestType.parse('mri'), LabTestType.other);
    });
    test('covers every status the backend can send', () {
      for (final s in [
        'PENDING_PAYMENT',
        'CONFIRMED',
        'IN_QUEUE',
        'COMPLETED',
        'NO_SHOW',
        'EXPIRED',
        'CANCELLED'
      ]) {
        expect(AppointmentStatus.parse(s), isNot(AppointmentStatus.unknown),
            reason: s);
      }
    });
  });

  group('models', () {
    test('Appointment parses server JSON incl. patient on the doctor schedule',
        () {
      final a = Appointment.fromJson({
        'id': 'a1',
        'doctorId': 'd1',
        'slot': '09:30',
        'date': '2026-11-02T00:00:00.000Z',
        'status': 'IN_QUEUE',
        'feePaise': 50000,
        'mdrPaise': 1000,
        'totalPaise': 51000,
        'user': {'id': 'u1', 'name': 'Ravi', 'phone': '9000000001'},
      });
      expect(a.status, AppointmentStatus.inQueue);
      expect(a.price.totalPaise, 51000);
      expect(a.patient!.label, 'Ravi');
      expect(a.date.isUtc, isTrue);
    });
    test('LabBooking reads pricePaise as the fee', () {
      final b = LabBooking.fromJson({
        'id': 'b',
        'labId': 'l',
        'testId': 't',
        'status': 'PENDING_PAYMENT',
        'pricePaise': 40000,
        'mdrPaise': 800,
        'totalPaise': 40800,
        'reportUrl': null,
      });
      expect(b.price,
          const Price(feePaise: 40000, mdrPaise: 800, totalPaise: 40800));
    });
    test('PharmaOrder.payable adds MDR to the quoted subtotal', () {
      final o = PharmaOrder.fromJson({
        'id': 'o',
        'pharmaId': 'p',
        'status': 'quoted',
        'totalPaise': 5000,
        'createdAt': '2026-11-01T10:00:00.000Z',
        'items': [
          {'name': 'ORS', 'qty': 1}
        ],
        'quotedItems': [
          {'name': 'ORS', 'qty': 1, 'unitPricePaise': 5000}
        ],
      });
      expect(o.payable.totalPaise, 5100);
      expect(o.quotedItems!.single.unitPricePaise, 5000);
    });
    test('RatingSummary with no ratings', () {
      final r =
          RatingSummary.fromJson({'average': null, 'count': 0, 'ratings': []});
      expect(r.average, isNull);
    });
  });

  group('ApiClient', () {
    test(
        'sends bearer token, JSON body, trims base url, drops null query params',
        () async {
      late http.Request seen;
      final c = clientFor(MockClient((r) async {
        seen = r;
        return http.Response('{"ok":true}', 200);
      }), token: 'tok');
      final res = await c.post('/x', body: {'a': 1});
      expect(res, {'ok': true});
      expect(seen.url.toString(), 'http://api.test/x');
      expect(seen.headers['Authorization'], 'Bearer tok');
      expect(jsonDecode(seen.body), {'a': 1});

      await c.get('/doctors', query: {'q': 'dr s', 'stream': null});
      expect(seen.url.queryParameters, {'q': 'dr s'});
    });
    test('no Authorization header without a token', () async {
      late http.Request seen;
      final c = clientFor(MockClient((r) async {
        seen = r;
        return http.Response('{}', 200);
      }));
      await c.get('/doctors');
      expect(seen.headers.containsKey('Authorization'), isFalse);
    });
    test('empty 2xx body returns null', () async {
      final c = clientFor(MockClient((_) async => http.Response('', 204)));
      expect(await c.delete('/x'), isNull);
    });
    test('Nest error messages: string, validation list, missing', () async {
      Future<ApiException> errorOf(String body, int code) async {
        final c = clientFor(MockClient((_) async => http.Response(body, code)));
        try {
          await c.get('/x');
        } on ApiException catch (e) {
          return e;
        }
        fail('did not throw');
      }

      var e = await errorOf(
          '{"message":"Slot not available","statusCode":409}', 409);
      expect((e.status, e.message, e.isConflict),
          (409, 'Slot not available', true));
      e = await errorOf(
          '{"message":["phone must be 10 digits","otp must be a string"]}',
          400);
      expect(e.message, 'phone must be 10 digits\notp must be a string');
      e = await errorOf('<html>bad gateway</html>', 502);
      expect(e.status, 502);
      expect(e.message, isNotEmpty);
    });
    test(
        '401 with a token fires onUnauthorized; 401 without one (wrong OTP) does not',
        () async {
      var fired = 0;
      final m = MockClient(
          (_) async => http.Response('{"message":"Invalid token"}', 401));
      await expectLater(
          clientFor(m, token: 't', onUnauthorized: () => fired++)
              .get('/auth/me'),
          throwsA(isA<ApiException>()));
      expect(fired, 1);
      await expectLater(
          clientFor(m, onUnauthorized: () => fired++).post('/auth/otp/verify'),
          throwsA(isA<ApiException>()));
      expect(fired, 1);
    });
    test('network failure and timeout become status-0 ApiExceptions', () async {
      final down = clientFor(MockClient(
          (_) async => throw http.ClientException('connection refused')));
      await expectLater(
          down.get('/x'),
          throwsA(isA<ApiException>()
              .having((e) => e.isNetwork, 'isNetwork', true)));

      final slow = ApiClient(
        baseUrl: 'http://api.test',
        timeout: const Duration(milliseconds: 20),
        httpClient: MockClient((_) async {
          await Future<void>.delayed(const Duration(milliseconds: 200));
          return http.Response('{}', 200);
        }),
      );
      await expectLater(
          slow.get('/x'),
          throwsA(isA<ApiException>()
              .having((e) => e.message, 'message', contains('timed out'))));
    });
  });

  test('DoctorsApi.register validates the HPR id before calling the server',
      () {
    var called = false;
    final api = Api(
        baseUrl: 'http://api.test',
        httpClient: MockClient((_) async {
          called = true;
          return http.Response('{}', 201);
        }));
    expect(
      () => api.doctors.register(
          hprId: '123',
          medicalStream: MedicalStream.mbbs,
          specialization: 'x',
          feePaise: 100),
      throwsArgumentError,
    );
    expect(called, isFalse);
  });
}
