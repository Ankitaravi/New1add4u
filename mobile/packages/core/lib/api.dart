/// Typed models and services for every backend module, on top of [ApiClient].
///
/// ```dart
/// import 'package:core/api.dart' as v2;   // prefix avoids clashes with older model names
/// final api = v2.Api(apiClient);
/// final slots = await api.appointments.slots(doctorId, DateTime(2026, 11, 2));
/// ```
library;

export 'src/api/api.dart';
export 'src/api/enums.dart';
export 'src/api/models.dart';
export 'src/api/money.dart';
export 'src/api/services/services.dart';
export 'src/api/transport.dart';
