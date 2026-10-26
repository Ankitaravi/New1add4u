import '../api_client.dart';
import '../models.dart';

class AuthResult {
  const AuthResult({required this.token, required this.user});
  final String token;
  final User user;
}

/// OTP login and the signed-in user's profile and family.
class AuthApi {
  AuthApi(this._c);
  final ApiClient _c;

  Future<void> sendOtp(String phone) async =>
      _c.post('/auth/otp/send', body: {'phone': phone});

  Future<AuthResult> verifyOtp(String phone, String otp) async {
    final j = await _c
        .post('/auth/otp/verify', body: {'phone': phone, 'otp': otp}) as Json;
    return AuthResult(
        token: j['token'] as String, user: User.fromJson(j['user'] as Json));
  }

  Future<User> me() async => User.fromJson(await _c.get('/auth/me') as Json);

  Future<void> logout() async => _c.post('/auth/logout');

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
