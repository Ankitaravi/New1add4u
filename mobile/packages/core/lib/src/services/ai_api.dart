import '../api_client.dart';
import '../models.dart';

/// AI helpers. A 503 [ApiException] means AI is not configured on the server; a 429 means the
/// user hit the hourly limit. Always show [SymptomResult.disclaimer] with the answer.
class AiApi {
  AiApi(this._c);
  final ApiClient _c;

  Future<SymptomResult> symptomCheck(String symptoms, {int? age}) async =>
      SymptomResult.fromJson(await _c.post('/ai/symptom-check',
          body: {'symptoms': symptoms, if (age != null) 'age': age}) as Json);

  /// 2–10 drug names.
  Future<InteractionResult> drugInteraction(List<String> drugs) async =>
      InteractionResult.fromJson(await _c
          .post('/ai/drug-interaction', body: {'drugs': drugs}) as Json);
}
