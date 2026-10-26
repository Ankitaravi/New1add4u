import '../api_client.dart';
import '../enums.dart';
import '../models.dart';

class HealthRecordsApi {
  HealthRecordsApi(this._c);
  final ApiClient _c;

  /// [kind]: prescription | lab_report | vitals | allergy | note | other.
  Future<HealthRecord> add(
          {required String title,
          required String kind,
          Map<String, dynamic>? data}) async =>
      HealthRecord.fromJson(await _c.post('/health-records', body: {
        'title': title,
        'kind': kind,
        if (data != null) 'data': data
      }) as Json);

  Future<List<HealthRecord>> list({String? kind}) async =>
      (await _c.get('/health-records', query: {'kind': kind}) as List)
          .map((e) => HealthRecord.fromJson(e as Json))
          .toList();

  Future<HealthRecord> byId(String id) async =>
      HealthRecord.fromJson(await _c.get('/health-records/$id') as Json);

  Future<void> delete(String id) async => _c.delete('/health-records/$id');
}

class NotificationsApi {
  NotificationsApi(this._c);
  final ApiClient _c;

  Future<NotificationPage> list({bool unreadOnly = false}) async =>
      NotificationPage.fromJson(await _c.get('/notifications',
          query: {'unread': unreadOnly ? 'true' : null}) as Json);

  Future<void> markRead(String id) async => _c.patch('/notifications/$id');

  Future<void> markAllRead() async => _c.patch('/notifications/read-all');

  /// Call after sign-in and whenever Firebase rotates the FCM token. [platform]: android | ios | web.
  Future<void> registerDevice(String fcmToken,
          {required String platform}) async =>
      _c.post('/notifications/device-token',
          body: {'token': fcmToken, 'platform': platform});

  /// Call on sign-out so the old user stops receiving pushes on this device.
  Future<void> unregisterDevice(String fcmToken) async =>
      _c.delete('/notifications/device-token/${Uri.encodeComponent(fcmToken)}');
}

class ReferralsApi {
  ReferralsApi(this._c);
  final ApiClient _c;

  /// 409 if already on 1ADD4U or already referred by you.
  Future<void> refer(String phone) async =>
      _c.post('/referrals', body: {'phone': phone});

  Future<List<Referral>> mine() async => (await _c.get('/referrals/my') as List)
      .map((e) => Referral.fromJson(e as Json))
      .toList();
}

class StudentsApi {
  StudentsApi(this._c);
  final ApiClient _c;

  Future<void> saveProfile({String? college, MedicalStream? stream}) async =>
      _c.put('/students/profile', body: {
        if (college != null) 'college': college,
        if (stream != null) 'stream': stream.wire,
      });

  Future<List<Course>> courses({MedicalStream? stream}) async =>
      (await _c.get('/students/courses', query: {'stream': stream?.wire})
              as List)
          .map((e) => Course.fromJson(e as Json))
          .toList();

  Future<List<Enrollment>> myCourses() async =>
      (await _c.get('/students/my-courses') as List)
          .map((e) => Enrollment.fromJson(e as Json))
          .toList();

  /// 409 if already enrolled.
  Future<Enrollment> enroll(String courseId) async => Enrollment.fromJson(
      await _c.post('/students/courses/$courseId/enroll') as Json);

  /// Lessons completed; never moves backwards and cannot exceed the course's lessons.
  Future<Enrollment> setProgress(String courseId, int lessonsDone) async =>
      Enrollment.fromJson(await _c.patch('/students/courses/$courseId/progress',
          body: {'progress': lessonsDone}) as Json);
}
