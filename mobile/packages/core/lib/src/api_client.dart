import 'dart:async';
import 'dart:convert';
import 'dart:io' show SocketException;

import 'package:http/http.dart' as http;

/// A failed API call. [status] is the HTTP status, or 0 when the server could not be reached.
class ApiException implements Exception {
  ApiException(this.status, this.message);

  final int status;
  final String message;

  bool get isNetwork => status == 0;
  bool get isUnauthorized => status == 401;
  bool get isForbidden => status == 403;
  bool get isNotFound => status == 404;
  bool get isConflict => status == 409;

  @override
  String toString() => 'ApiException($status): $message';
}

typedef TokenProvider = String? Function();

/// Thin JSON-over-HTTP client for the NestJS backend. Attaches the bearer token, turns
/// error responses into [ApiException]s, and reports 401s on authenticated calls so the
/// app can sign the user out.
class ApiClient {
  ApiClient({
    required String baseUrl,
    http.Client? httpClient,
    this.tokenProvider,
    this.onUnauthorized,
    this.timeout = const Duration(seconds: 20),
  })  : baseUrl = baseUrl.replaceFirst(RegExp(r'/+$'), ''),
        _http = httpClient ?? http.Client();

  final String baseUrl;
  final TokenProvider? tokenProvider;

  /// Called when an authenticated request comes back 401 (expired or revoked token).
  /// Not called for unauthenticated calls such as a wrong OTP.
  void Function()? onUnauthorized;
  final Duration timeout;
  final http.Client _http;

  Future<dynamic> get(String path, {Map<String, Object?>? query}) =>
      request('GET', path, query: query);
  Future<dynamic> post(String path, {Object? body}) =>
      request('POST', path, body: body);
  Future<dynamic> put(String path, {Object? body}) =>
      request('PUT', path, body: body);
  Future<dynamic> patch(String path, {Object? body}) =>
      request('PATCH', path, body: body);
  Future<dynamic> delete(String path) => request('DELETE', path);

  Future<dynamic> request(String method, String path,
      {Map<String, Object?>? query, Object? body}) async {
    final params = <String, String>{
      for (final e in (query ?? const <String, Object?>{}).entries)
        if (e.value != null) e.key: e.value.toString(),
    };
    var uri = Uri.parse('$baseUrl$path');
    if (params.isNotEmpty) {
      uri = uri.replace(queryParameters: {...uri.queryParameters, ...params});
    }

    final token = tokenProvider?.call();
    final req = http.Request(method, uri)
      ..headers['Accept'] = 'application/json'
      ..headers['Content-Type'] = 'application/json';
    if (token != null) req.headers['Authorization'] = 'Bearer $token';
    if (body != null) req.body = jsonEncode(body);

    final http.Response res;
    try {
      res = await http.Response.fromStream(
          await _http.send(req).timeout(timeout));
    } on TimeoutException {
      throw ApiException(
          0, 'The request timed out. Check your connection and try again.');
    } on SocketException {
      throw ApiException(
          0, 'Could not reach the server. Check your connection.');
    } on http.ClientException catch (e) {
      throw ApiException(0, 'Network error: ${e.message}');
    }

    final text = utf8.decode(res.bodyBytes);
    dynamic data;
    if (text.isNotEmpty) {
      try {
        data = jsonDecode(text);
      } on FormatException {
        data = null;
      }
    }
    if (res.statusCode >= 200 && res.statusCode < 300) return data;

    if (res.statusCode == 401 && token != null) onUnauthorized?.call();
    throw ApiException(res.statusCode, _messageOf(data, res));
  }

  /// NestJS sends `message` as a string, or a list when validation fails on several fields.
  static String _messageOf(dynamic data, http.Response res) {
    if (data is Map && data['message'] != null) {
      final m = data['message'];
      return m is List ? m.join('\n') : m.toString();
    }
    return res.reasonPhrase ?? 'Request failed (${res.statusCode})';
  }

  void close() => _http.close();
}
