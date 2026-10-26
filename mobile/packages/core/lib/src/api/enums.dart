// Every enum carries the exact string the backend sends/expects in [wire]. Unknown values
// parse to `unknown` so a newer server never crashes an older app.

enum Role {
  user('USER'),
  doctor('DOCTOR'),
  staff('STAFF'),
  pharma('PHARMA'),
  investigation('INVESTIGATION'),
  student('STUDENT'),
  hospitalAdmin('HOSPITAL_ADMIN'),
  superAdmin('SUPER_ADMIN'),
  unknown('');

  const Role(this.wire);
  final String wire;
  static Role parse(String? s) =>
      values.firstWhere((e) => e.wire == s, orElse: () => unknown);
}

enum MedicalStream {
  mbbs('mbbs'),
  dental('dental'),
  ayurveda('ayurveda'),
  homeopathy('homeopathy'),
  unknown('');

  const MedicalStream(this.wire);
  final String wire;
  static MedicalStream parse(String? s) =>
      values.firstWhere((e) => e.wire == s, orElse: () => unknown);
}

/// PENDING_PAYMENT -> CONFIRMED -> IN_QUEUE -> COMPLETED / NO_SHOW / EXPIRED (or CANCELLED).
enum AppointmentStatus {
  pendingPayment('PENDING_PAYMENT'),
  confirmed('CONFIRMED'),
  inQueue('IN_QUEUE'),
  completed('COMPLETED'),
  noShow('NO_SHOW'),
  expired('EXPIRED'),
  cancelled('CANCELLED'),
  unknown('');

  const AppointmentStatus(this.wire);
  final String wire;
  static AppointmentStatus parse(String? s) =>
      values.firstWhere((e) => e.wire == s, orElse: () => unknown);
}

/// PENDING_PAYMENT -> CONFIRMED -> SAMPLE_COLLECTED -> REPORT_UPLOADED -> COMPLETED.
enum LabStatus {
  pendingPayment('PENDING_PAYMENT'),
  confirmed('CONFIRMED'),
  sampleCollected('SAMPLE_COLLECTED'),
  reportUploaded('REPORT_UPLOADED'),
  completed('COMPLETED'),
  cancelled('CANCELLED'),
  unknown('');

  const LabStatus(this.wire);
  final String wire;
  static LabStatus parse(String? s) =>
      values.firstWhere((e) => e.wire == s, orElse: () => unknown);
}

/// requested -> quoted -> paid -> ready -> completed (or rejected / cancelled / expired).
enum OrderStatus {
  requested('requested'),
  quoted('quoted'),
  rejected('rejected'),
  paid('paid'),
  ready('ready'),
  completed('completed'),
  cancelled('cancelled'),
  expired('expired'),
  unknown('');

  const OrderStatus(this.wire);
  final String wire;
  static OrderStatus parse(String? s) =>
      values.firstWhere((e) => e.wire == s, orElse: () => unknown);
}

enum VisitStatus {
  pendingPayment('PENDING_PAYMENT'),
  confirmed('CONFIRMED'),
  inProgress('IN_PROGRESS'),
  completed('COMPLETED'),
  cancelled('CANCELLED'),
  unknown('');

  const VisitStatus(this.wire);
  final String wire;
  static VisitStatus parse(String? s) =>
      values.firstWhere((e) => e.wire == s, orElse: () => unknown);
}

enum ArticleStatus {
  pending('PENDING'),
  approved('APPROVED'),
  rejected('REJECTED'),
  unknown('');

  const ArticleStatus(this.wire);
  final String wire;
  static ArticleStatus parse(String? s) =>
      values.firstWhere((e) => e.wire == s, orElse: () => unknown);
}

enum LabTestType {
  cbc('cbc'),
  bloodSugar('bloodSugar'),
  hba1c('hba1c'),
  lipidProfile('lipidProfile'),
  liverFunction('liverFunction'),
  kidneyFunction('kidneyFunction'),
  thyroidProfile('thyroidProfile'),
  urineRoutine('urineRoutine'),
  vitaminD('vitaminD'),
  vitaminB12('vitaminB12'),
  xray('xray'),
  ecg('ecg'),
  ultrasound('ultrasound'),
  other('other');

  const LabTestType(this.wire);
  final String wire;
  static LabTestType parse(String? s) =>
      values.firstWhere((e) => e.wire == s, orElse: () => other);
}

enum ServiceType {
  injection('injection'),
  dressing('dressing'),
  ivDrip('ivDrip'),
  catheterCare('catheterCare'),
  woundCare('woundCare'),
  postOperativeCare('postOperativeCare'),
  elderlyCare('elderlyCare'),
  bpSugarCheck('bpSugarCheck'),
  other('other');

  const ServiceType(this.wire);
  final String wire;
  static ServiceType parse(String? s) =>
      values.firstWhere((e) => e.wire == s, orElse: () => other);
}

/// What a payment is for; sent to `/payments/create-order`.
enum PaymentPurpose {
  appointment('APPOINTMENT'),
  labBooking('LAB_BOOKING'),
  pharmaOrder('PHARMA_ORDER'),
  staffVisit('STAFF_VISIT');

  const PaymentPurpose(this.wire);
  final String wire;
  static PaymentPurpose parse(String? s) =>
      values.firstWhere((e) => e.wire == s, orElse: () => appointment);
}

enum Urgency {
  selfCare('self_care'),
  seeDoctor('see_doctor'),
  emergency('emergency');

  const Urgency(this.wire);
  final String wire;
  static Urgency parse(String? s) =>
      values.firstWhere((e) => e.wire == s, orElse: () => seeDoctor);
}
