import '../transport.dart';
import '../enums.dart';
import '../models.dart';
import '../money.dart';

/// Doctor discovery (patients) and the doctor app's own profile, availability and schedule.
class DoctorsApi {
  DoctorsApi(this._c);
  final Transport _c;

  // ---- patient side ----

  /// Verified doctors only.
  Future<List<DoctorProfile>> search(
          {String? specialization,
          MedicalStream? stream,
          String? name}) async =>
      (await _c.get('/doctors', query: {
        'specialization': specialization,
        'stream': stream?.wire,
        'q': name
      }) as List)
          .map((e) => DoctorProfile.fromJson(e as Json))
          .toList();

  Future<DoctorProfile> byId(String id) async =>
      DoctorProfile.fromJson(await _c.get('/doctors/$id') as Json);

  // ---- doctor side ----

  /// Turns the signed-in patient into an (unverified) doctor. [hprId] must be 14 digits.
  Future<DoctorProfile> register({
    required String hprId,
    required MedicalStream medicalStream,
    required String specialization,
    required int feePaise,
  }) async {
    if (!validHprId(hprId)) {
      throw ArgumentError('HPR ID must be exactly 14 digits');
    }
    return DoctorProfile.fromJson(await _c.post('/doctors/register', body: {
      'hprId': hprId.replaceAll('-', ''),
      'medicalStream': medicalStream.wire,
      'specialization': specialization,
      'feePaise': feePaise,
    }) as Json);
  }

  Future<DoctorProfile> myProfile() async =>
      DoctorProfile.fromJson(await _c.get('/doctors/profile') as Json);

  Future<DoctorProfile> updateProfile(
          {String? specialization, int? feePaise}) async =>
      DoctorProfile.fromJson(await _c.patch('/doctors/profile', body: {
        if (specialization != null) 'specialization': specialization,
        if (feePaise != null) 'feePaise': feePaise,
      }) as Json);

  Future<List<AvailabilityDay>> availability() async =>
      (await _c.get('/doctors/availability') as List)
          .map((e) => AvailabilityDay.fromJson(e as Json))
          .toList();

  /// Replaces the whole weekly schedule.
  Future<List<AvailabilityDay>> setAvailability(
          List<AvailabilityDay> days) async =>
      (await _c.put('/doctors/availability',
              body: {'days': days.map((d) => d.toJson()).toList()}) as List)
          .map((e) => AvailabilityDay.fromJson(e as Json))
          .toList();

  /// Paid appointments on [date], earliest first.
  Future<List<Appointment>> schedule(DateTime date) async =>
      (await _c.get('/doctors/schedule', query: {'date': formatDay(date)})
              as List)
          .map((e) => Appointment.fromJson(e as Json))
          .toList();

  // ---- ratings ----

  Future<RatingSummary> ratings(String doctorId) async =>
      RatingSummary.fromJson(await _c.get('/ratings/doctor/$doctorId') as Json);

  /// Allowed only after a completed appointment with this doctor; rating again updates it.
  Future<void> rate(String doctorId, int stars, {String? comment}) async =>
      _c.post('/ratings', body: {
        'doctorId': doctorId,
        'stars': stars,
        if (comment != null) 'comment': comment
      });
}
