import '../api_client.dart';

/// Adapts the app's [ApiClient] for the typed services.
///
/// [ApiClient] only returns JSON objects and wraps any other body as `{'data': ...}`; services
/// want the real shape back (lists included). Requests are always authenticated: login and
/// refresh belong to the app's `AuthController`, not to these services.
class Transport {
  Transport(this.client);

  final ApiClient client;

  Future<dynamic> get(String path, {Map<String, Object?>? query}) async =>
      _unwrap(await client.get(path, query: query));
  Future<dynamic> post(String path, {Object? body}) async =>
      _unwrap(await client.post(path, body: body, auth: true));
  Future<dynamic> put(String path, {Object? body}) async =>
      _unwrap(await client.put(path, body: body));
  Future<dynamic> patch(String path, {Object? body}) async =>
      _unwrap(await client.patch(path, body: body));
  Future<dynamic> delete(String path) async =>
      _unwrap(await client.delete(path));

  /// `{'data': [...]}` (and only that) is `ApiClient`'s wrapper for a non-object body.
  static dynamic _unwrap(Map<String, dynamic>? m) {
    if (m != null && m.length == 1 && m['data'] is List) return m['data'];
    return m;
  }
}
