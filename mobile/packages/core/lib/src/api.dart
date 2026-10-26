import 'package:http/http.dart' as http;

import 'api_client.dart';
import 'services/services.dart';

/// One object holding every typed service, sharing a single [ApiClient].
///
/// ```dart
/// final api = Api(baseUrl: 'https://api.example.com', tokenProvider: () => token);
/// final slots = await api.appointments.slots(doctorId, DateTime(2026, 11, 2));
/// ```
class Api {
  Api(
      {required String baseUrl,
      TokenProvider? tokenProvider,
      void Function()? onUnauthorized,
      http.Client? httpClient})
      : client = ApiClient(
          baseUrl: baseUrl,
          tokenProvider: tokenProvider,
          onUnauthorized: onUnauthorized,
          httpClient: httpClient,
        ) {
    auth = AuthApi(client);
    doctors = DoctorsApi(client);
    appointments = AppointmentsApi(client);
    payments = PaymentsApi(client);
    labs = LabsApi(client);
    pharma = PharmaApi(client);
    staff = StaffApi(client);
    records = HealthRecordsApi(client);
    content = ContentApi(client);
    notifications = NotificationsApi(client);
    ai = AiApi(client);
    students = StudentsApi(client);
    referrals = ReferralsApi(client);
  }

  final ApiClient client;
  late final AuthApi auth;
  late final DoctorsApi doctors;
  late final AppointmentsApi appointments;
  late final PaymentsApi payments;
  late final LabsApi labs;
  late final PharmaApi pharma;
  late final StaffApi staff;
  late final HealthRecordsApi records;
  late final ContentApi content;
  late final NotificationsApi notifications;
  late final AiApi ai;
  late final StudentsApi students;
  late final ReferralsApi referrals;
}
