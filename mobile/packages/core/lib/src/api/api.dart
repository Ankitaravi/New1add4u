import '../api_client.dart';
import 'services/services.dart';
import 'transport.dart';

/// One object holding every typed service, sharing the app's [ApiClient] (and so its
/// token refresh and retry behaviour).
class Api {
  Api(ApiClient client) : transport = Transport(client) {
    auth = AuthApi(transport);
    doctors = DoctorsApi(transport);
    appointments = AppointmentsApi(transport);
    payments = PaymentsApi(transport);
    labs = LabsApi(transport);
    pharma = PharmaApi(transport);
    staff = StaffApi(transport);
    records = HealthRecordsApi(transport);
    content = ContentApi(transport);
    notifications = NotificationsApi(transport);
    ai = AiApi(transport);
    students = StudentsApi(transport);
    referrals = ReferralsApi(transport);
  }

  /// For one-off calls the typed services do not cover.
  final Transport transport;
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
