import '../api_client.dart';
import '../enums.dart';
import '../models.dart';

/// Labs and lab bookings: patient side and the investigation (lab) app.
class LabsApi {
  LabsApi(this._c);
  final ApiClient _c;

  // ---- patient ----

  Future<List<LabProfile>> labs() async => (await _c.get('/labs') as List)
      .map((e) => LabProfile.fromJson(e as Json))
      .toList();

  Future<List<LabTest>> testsOf(String labId) async =>
      (await _c.get('/labs/$labId/tests') as List)
          .map((e) => LabTest.fromJson(e as Json))
          .toList();

  Future<LabBooking> book(String testId) async => LabBooking.fromJson(
      await _c.post('/lab-bookings/book', body: {'testId': testId}) as Json);

  Future<List<LabBooking>> myBookings() async =>
      (await _c.get('/lab-bookings/my') as List)
          .map((e) => LabBooking.fromJson(e as Json))
          .toList();

  Future<LabBooking> booking(String id) async =>
      LabBooking.fromJson(await _c.get('/lab-bookings/$id') as Json);

  /// Creates the Razorpay order for an unpaid booking (same as `PaymentsApi.createOrder`).
  Future<PaymentOrder> pay(String bookingId) async => PaymentOrder.fromJson(
      await _c.post('/lab-bookings/$bookingId/pay') as Json);

  /// Only while unpaid.
  Future<LabBooking> cancel(String id) async =>
      LabBooking.fromJson(await _c.patch('/lab-bookings/$id/cancel') as Json);

  // ---- lab technician ----

  Future<LabProfile> saveProfile({required String name, String? city}) async =>
      LabProfile.fromJson(await _c.put('/labs/profile',
          body: {'name': name, if (city != null) 'city': city}) as Json);

  Future<LabProfile> myProfile() async =>
      LabProfile.fromJson(await _c.get('/labs/profile') as Json);

  Future<LabTest> addTest(
          {required LabTestType type,
          required String name,
          required int pricePaise}) async =>
      LabTest.fromJson(await _c.post('/labs/tests',
              body: {'type': type.wire, 'name': name, 'pricePaise': pricePaise})
          as Json);

  Future<LabTest> updateTest(String id,
          {String? name, int? pricePaise}) async =>
      LabTest.fromJson(await _c.patch('/labs/tests/$id', body: {
        if (name != null) 'name': name,
        if (pricePaise != null) 'pricePaise': pricePaise,
      }) as Json);

  /// 409 if the test already has bookings.
  Future<void> deleteTest(String id) async => _c.delete('/labs/tests/$id');

  /// Paid bookings for this lab.
  Future<List<LabBooking>> incoming() async =>
      (await _c.get('/lab-bookings/incoming') as List)
          .map((e) => LabBooking.fromJson(e as Json))
          .toList();

  /// sampleCollected -> reportUploaded (needs [reportUrl]) -> completed.
  Future<LabBooking> setStatus(String id, LabStatus status,
          {String? reportUrl}) async =>
      LabBooking.fromJson(await _c.patch('/lab-bookings/$id/status', body: {
        'status': status.wire,
        if (reportUrl != null) 'reportUrl': reportUrl
      }) as Json);
}
