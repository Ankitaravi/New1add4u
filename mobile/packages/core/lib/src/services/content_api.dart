import '../api_client.dart';
import '../models.dart';

/// Health articles. Doctors (verified) and students write; admins moderate before publishing.
class ContentApi {
  ContentApi(this._c);
  final ApiClient _c;

  /// Approved articles, newest first.
  Future<List<Article>> articles(
          {String? query, int page = 1, int limit = 20}) async =>
      (await _c.get('/content/articles',
              query: {'q': query, 'page': page, 'limit': limit}) as List)
          .map((e) => Article.fromJson(e as Json))
          .toList();

  Future<Article> article(String id) async =>
      Article.fromJson(await _c.get('/content/articles/$id') as Json);

  /// The signed-in author's own articles, including pending and rejected ones.
  Future<List<Article>> mine() async =>
      (await _c.get('/content/articles/mine') as List)
          .map((e) => Article.fromJson(e as Json))
          .toList();

  /// Starts as PENDING until an admin approves it.
  Future<Article> write({required String title, required String body}) async =>
      Article.fromJson(await _c.post('/content/articles',
          body: {'title': title, 'body': body}) as Json);

  /// Editing sends it back to moderation.
  Future<Article> edit(String id, {String? title, String? body}) async =>
      Article.fromJson(await _c.patch('/content/articles/$id', body: {
        if (title != null) 'title': title,
        if (body != null) 'body': body,
      }) as Json);
}
