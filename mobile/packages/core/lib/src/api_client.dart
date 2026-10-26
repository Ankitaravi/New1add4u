import 'dart:convert';

import 'package:http/http.dart' as http;

/// An error response from the backend.
class ApiException implements Exception {
  ApiException(this.statusCode, this.message);

  final int statusCode;
  final String message;

  // Convenience used by the typed services in `api.dart`.
  int get status => statusCode;
  bool get isUnauthorized => statusCode == 401;
  bool get isForbidden => statusCode == 403;
  bool get isNotFound => statusCode == 404;
  bool get isConflict => statusCode == 409;

  @override
  String toString() => 'ApiException($statusCode): $message';
}

/// Supplies the access token and renews it. Implemented by the auth package,
/// so this package does not need to know how login works.
abstract interface class TokenProvider {
  Future<String?> accessToken();

  /// Returns true when a new access token was obtained.
  Future<bool> refresh();
}

/// JSON client for the 1ADD4U backend. On a 401 it renews the access token
/// once and retries the request.
class ApiClient {
  ApiClient({required this.baseUrl, http.Client? client}) : _http = client ?? http.Client();

  final String baseUrl;
  final http.Client _http;
  TokenProvider? tokens;

  Future<Map<String, dynamic>?> get(String path, {Map<String, Object?>? query}) =>
      _send('GET', path, query: query, auth: true);

  Future<Map<String, dynamic>?> post(String path, {Object? body, bool auth = false}) =>
      _send('POST', path, body: body, auth: auth);

  Future<Map<String, dynamic>?> patch(String path, {Object? body}) =>
      _send('PATCH', path, body: body, auth: true);

  Future<Map<String, dynamic>?> put(String path, {Object? body}) => _send('PUT', path, body: body, auth: true);

  Future<Map<String, dynamic>?> delete(String path, {Object? body}) =>
      _send('DELETE', path, body: body, auth: true);

  Future<Map<String, dynamic>?> _send(
    String method,
    String path, {
    Object? body,
    Map<String, Object?>? query,
    required bool auth,
    bool retried = false,
  }) async {
    final provider = tokens;
    var uri = Uri.parse('$baseUrl$path');
    final params = {
      for (final e in (query ?? const <String, Object?>{}).entries)
        if (e.value != null) e.key: e.value.toString(),
    };
    if (params.isNotEmpty) {
      uri = uri.replace(queryParameters: {...uri.queryParameters, ...params});
    }
    final request = http.Request(method, uri)
      ..headers['Content-Type'] = 'application/json'
      ..headers['Accept'] = 'application/json';
    if (auth && provider != null) {
      final token = await provider.accessToken();
      if (token != null) request.headers['Authorization'] = 'Bearer $token';
    }
    if (body != null) request.body = jsonEncode(body);

    final streamed = await _http.send(request).timeout(const Duration(seconds: 20));
    final response = await http.Response.fromStream(streamed);

    if (response.statusCode == 401 && auth && !retried && provider != null && await provider.refresh()) {
      return _send(method, path, body: body, query: query, auth: auth, retried: true);
    }
    if (response.statusCode >= 400) {
      throw ApiException(response.statusCode, _messageFrom(response.body));
    }
    if (response.body.isEmpty) return null;
    final decoded = jsonDecode(utf8.decode(response.bodyBytes));
    return decoded is Map<String, dynamic> ? decoded : <String, dynamic>{'data': decoded};
  }

  static String _messageFrom(String body) {
    try {
      final decoded = jsonDecode(body);
      if (decoded is Map && decoded['message'] != null) {
        final message = decoded['message'];
        return message is List ? message.join(', ') : message.toString();
      }
    } on FormatException {
      return body.isEmpty ? 'Request failed' : body;
    }
    return body.isEmpty ? 'Request failed' : body;
  }
}
