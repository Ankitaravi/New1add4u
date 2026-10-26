import '../api_client.dart';
import '../enums.dart';
import '../models.dart';

/// Home-visit nursing: patient side and the staff app.
class StaffApi {
  StaffApi(this._c);
  final ApiClient _c;

  // ---- patient ----

  Future<List<StaffProfile>> search(
          {String? city, ServiceType? service}) async =>
      (await _c.get('/staff', query: {'city': city, 'service': service?.wire})
              as List)
          .map((e) => StaffProfile.fromJson(e as Json))
          .toList();

  /// [scheduledAt] must be in the future.
  Future<StaffVisit> bookVisit({
    required String staffId,
    required ServiceType service,
    required String address,
    required DateTime scheduledAt,
  }) async =>
      StaffVisit.fromJson(await _c.post('/staff/visits/book', body: {
        'staffId': staffId,
        'serviceType': service.wire,
        'address': address,
        'scheduledAt': scheduledAt.toUtc().toIso8601String(),
      }) as Json);

  Future<List<StaffVisit>> myVisits() async =>
      (await _c.get('/staff/visits/my') as List)
          .map((e) => StaffVisit.fromJson(e as Json))
          .toList();

  Future<StaffVisit> visit(String id) async =>
      StaffVisit.fromJson(await _c.get('/staff/visits/$id') as Json);

  Future<PaymentOrder> pay(String visitId) async => PaymentOrder.fromJson(
      await _c.post('/staff/visits/$visitId/pay') as Json);

  Future<StaffVisit> cancel(String id) async =>
      StaffVisit.fromJson(await _c.patch('/staff/visits/$id/cancel') as Json);

  // ---- staff ----

  Future<StaffProfile> saveProfile(
          {required String name, String? city}) async =>
      StaffProfile.fromJson(await _c.put('/staff/profile',
          body: {'name': name, if (city != null) 'city': city}) as Json);

  Future<StaffProfile> myProfile() async =>
      StaffProfile.fromJson(await _c.get('/staff/profile') as Json);

  /// Replaces the whole service/price list.
  Future<List<StaffService>> setServices(List<StaffService> services) async =>
      (await _c.put('/staff/services',
                  body: {'services': services.map((s) => s.toJson()).toList()})
              as List)
          .map((e) => StaffService.fromJson(e as Json))
          .toList();

  /// Paid visits assigned to this staff member.
  Future<List<StaffVisit>> incoming() async =>
      (await _c.get('/staff/visits/incoming') as List)
          .map((e) => StaffVisit.fromJson(e as Json))
          .toList();

  /// inProgress, then completed.
  Future<StaffVisit> setStatus(String id, VisitStatus status) async =>
      StaffVisit.fromJson(await _c.patch('/staff/visits/$id/status',
          body: {'status': status.wire}) as Json);
}
