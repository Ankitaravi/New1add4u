import '../api_client.dart';
import '../enums.dart';
import '../models.dart';
import '../money.dart';

class AppointmentsApi {
  AppointmentsApi(this._c);
  final ApiClient _c;

  /// Open "HH:MM" slots for a doctor on a day, plus the price the patient will pay.
  Future<SlotDay> slots(String doctorId, DateTime date) async =>
      SlotDay.fromJson(await _c.get('/appointments/slots/$doctorId',
          query: {'date': formatDay(date)}) as Json);

  /// Holds the slot as PENDING_PAYMENT for 10 minutes; pay it with [PaymentsApi] before then.
  /// Throws a 409 [ApiException] if someone else took the slot.
  Future<Appointment> book(
          {required String doctorId,
          required DateTime date,
          required String slot}) async =>
      Appointment.fromJson(await _c.post('/appointments/book', body: {
        'doctorId': doctorId,
        'date': formatDay(date),
        'slot': slot
      }) as Json);

  Future<List<Appointment>> mine() async =>
      (await _c.get('/appointments/my') as List)
          .map((e) => Appointment.fromJson(e as Json))
          .toList();

  Future<Appointment> byId(String id) async =>
      Appointment.fromJson(await _c.get('/appointments/$id') as Json);

  /// Patient cancel. A paid appointment is refunded.
  Future<Appointment> cancel(String id) async =>
      Appointment.fromJson(await _c.patch('/appointments/$id/cancel') as Json);

  /// Doctor moves a booking forward: inQueue, completed or noShow.
  Future<Appointment> setStatus(String id, AppointmentStatus status) async =>
      Appointment.fromJson(await _c.patch('/appointments/$id/status',
          body: {'status': status.wire}) as Json);
}
