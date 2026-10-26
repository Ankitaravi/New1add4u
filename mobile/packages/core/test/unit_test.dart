import 'dart:convert';

import 'package:core/api.dart';
import 'package:core/core.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:test/test.dart';

/// Stands in for the app's AuthController.
class FakeTokens implements TokenProvider {
  FakeTokens(this.token, {this.refreshWorks = true});
  String? token;
  bool refreshWorks;
  int refreshes = 0;

  @override
  Future<String?> accessToken() async => token;

  @override
  Future<bool> refresh() async {
    refreshes++;
    if (!refreshWorks) return false;
    token = 'new';
    return true;
  }
}

ApiClient clientFor(MockClient m, [FakeTokens? tokens]) =>
    ApiClient(baseUrl: 'http://api.test', client: m)..tokens = tokens;

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

  group('ApiClient (the app\'s own client)', () {
    test('sends bearer token on auth calls, JSON body, drops null query params',
        () async {
      late http.Request seen;
      final c = clientFor(MockClient((r) async {
        seen = r;
        return http.Response('{"ok":true}', 200);
      }), FakeTokens('tok'));
      expect(await c.post('/x', body: {'a': 1}, auth: true), {'ok': true});
      expect(seen.headers['Authorization'], 'Bearer tok');
      expect(jsonDecode(seen.body), {'a': 1});

      await c.get('/doctors', query: {'q': 'dr s', 'stream': null});
      expect(seen.url.toString(), 'http://api.test/doctors?q=dr+s');
    });
    test('post is unauthenticated by default (login endpoints)', () async {
      late http.Request seen;
      final c = clientFor(MockClient((r) async {
        seen = r;
        return http.Response('{}', 200);
      }), FakeTokens('tok'));
      await c.post('/auth/otp/request', body: {'phone': '9000000001'});
      expect(seen.headers.containsKey('Authorization'), isFalse);
    });
    test(
        '401 -> refresh once -> retry with the new token, keeping query and body',
        () async {
      final seen = <http.Request>[];
      final tokens = FakeTokens('old');
      final c = clientFor(MockClient((r) async {
        seen.add(r);
        return r.headers['Authorization'] == 'Bearer new'
            ? http.Response('{"ok":1}', 200)
            : http.Response('{"message":"Invalid token"}', 401);
      }), tokens);
      expect(await c.get('/doctors', query: {'q': 'x'}), {'ok': 1});
      expect(tokens.refreshes, 1);
      expect(seen.map((r) => r.headers['Authorization']),
          ['Bearer old', 'Bearer new']);
      expect(seen.last.url.queryParameters, {'q': 'x'});
    });
    test(
        '401 and refresh fails -> ApiException(401); a second 401 does not loop',
        () async {
      final a = FakeTokens('old', refreshWorks: false);
      await expectLater(
          clientFor(
                  MockClient(
                      (_) async => http.Response('{"message":"x"}', 401)),
                  a)
              .get('/me'),
          throwsA(isA<ApiException>()
              .having((e) => e.isUnauthorized, '401', true)));
      expect(a.refreshes, 1);

      var calls = 0;
      final b = FakeTokens('old');
      await expectLater(
          clientFor(MockClient((_) async {
            calls++;
            return http.Response('{"message":"still no"}', 401);
          }), b)
              .get('/me'),
          throwsA(isA<ApiException>()));
      expect((calls, b.refreshes), (2, 1));
    });
    test('error messages: string, validation list, plain text', () async {
      Future<ApiException> errorOf(String body, int code) async {
        try {
          await clientFor(MockClient((_) async => http.Response(body, code)))
              .get('/x');
        } on ApiException catch (e) {
          return e;
        }
        fail('did not throw');
      }

      var e = await errorOf(
          '{"message":"Slot not available","statusCode":409}', 409);
      expect((e.statusCode, e.status, e.message, e.isConflict),
          (409, 409, 'Slot not available', true));
      e = await errorOf(
          '{"message":["phone must be 10 digits","otp must be a string"]}',
          400);
      expect(e.message, 'phone must be 10 digits, otp must be a string');
      expect((await errorOf('', 500)).message, 'Request failed');
    });
    test('empty body is null; a list body is wrapped as {data: [...]}',
        () async {
      expect(
          await clientFor(MockClient((_) async => http.Response('', 204)))
              .delete('/x'),
          isNull);
      expect(
          await clientFor(MockClient((_) async => http.Response('[1,2]', 200)))
              .get('/x'),
          {
            'data': [1, 2]
          });
    });
  });

  group('Transport', () {
    Transport over(String body, {int code = 200}) => Transport(clientFor(
        MockClient((_) async => http.Response(body, code)), FakeTokens('t')));

    test('gives lists back as lists, objects as objects', () async {
      expect(await over('[{"id":"a"}]').get('/x'), [
        {'id': 'a'}
      ]);
      expect(await over('{"id":"a"}').get('/x'), {'id': 'a'});
      expect(await over('').delete('/x'), isNull);
    });
    test('an object that merely has a "data" field is not unwrapped', () async {
      final r = await over('{"id":"r1","title":"BP","data":{"sys":120}}')
          .get('/x') as Map;
      expect(r['id'], 'r1');
    });
    test('post is authenticated (typed services never log in)', () async {
      late http.Request seen;
      final t = Transport(clientFor(MockClient((r) async {
        seen = r;
        return http.Response('{}', 200);
      }), FakeTokens('tok')));
      await t.post('/appointments/book', body: {});
      expect(seen.headers['Authorization'], 'Bearer tok');
    });
  });

  test('DoctorsApi.register validates the HPR id before calling the server',
      () {
    var called = false;
    final api = Api(clientFor(MockClient((_) async {
      called = true;
      return http.Response('{}', 201);
    })));
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
