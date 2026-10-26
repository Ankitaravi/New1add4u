import '../transport.dart';
import '../models.dart';

/// The signed-in user's own profile and family. Login, refresh and logout belong to the
/// app's `AuthController` (OTP -> access + refresh tokens), not to this class.
class AuthApi {
  AuthApi(this._c);
  final Transport _c;

  Future<User> me() async => User.fromJson(await _c.get('/auth/me') as Json);

  Future<User> profile() async =>
      User.fromJson(await _c.get('/users/profile') as Json);

  Future<User> updateProfile(
          {String? name, String? email, String? gender, DateTime? dob}) async =>
      User.fromJson(await _c.patch('/users/profile', body: {
        if (name != null) 'name': name,
        if (email != null) 'email': email,
        if (gender != null) 'gender': gender,
        if (dob != null) 'dob': dob.toUtc().toIso8601String(),
      }) as Json);

  Future<List<FamilyMember>> family() async =>
      (await _c.get('/users/family') as List)
          .map((e) => FamilyMember.fromJson(e as Json))
          .toList();

  Future<FamilyMember> addFamilyMember(
          {required String name,
          required String relation,
          String? gender,
          DateTime? dob}) async =>
      FamilyMember.fromJson(await _c.post('/users/family', body: {
        'name': name,
        'relation': relation,
        if (gender != null) 'gender': gender,
        if (dob != null) 'dob': dob.toUtc().toIso8601String(),
      }) as Json);

  Future<void> removeFamilyMember(String id) async =>
      _c.delete('/users/family/$id');
}
