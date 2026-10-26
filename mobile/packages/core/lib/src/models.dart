import 'enums.dart';
import 'money.dart';

typedef Json = Map<String, dynamic>;

DateTime? _date(Object? v) => v == null ? null : DateTime.parse(v as String);
Price _priceOf(Json j) => Price(
      feePaise: (j['feePaise'] ?? j['pricePaise']) as int,
      mdrPaise: j['mdrPaise'] as int,
      totalPaise: j['totalPaise'] as int,
    );
List<T> _list<T>(Object? v, T Function(Json) f) =>
    (v as List? ?? const []).map((e) => f(e as Json)).toList();

/// Name/phone of the other party, attached to provider-side lists (a doctor sees the patient).
class PersonRef {
  const PersonRef({required this.id, this.name, this.phone});
  factory PersonRef.fromJson(Json j) => PersonRef(
      id: j['id'] as String,
      name: j['name'] as String?,
      phone: j['phone'] as String?);
  final String id;
  final String? name;
  final String? phone;
  String get label => name ?? phone ?? 'Patient';
}

class User {
  const User(
      {required this.id,
      required this.phone,
      required this.role,
      this.name,
      this.email,
      this.gender,
      this.dob});
  factory User.fromJson(Json j) => User(
        id: j['id'] as String,
        phone: j['phone'] as String,
        role: Role.parse(j['role'] as String?),
        name: j['name'] as String?,
        email: j['email'] as String?,
        gender: j['gender'] as String?,
        dob: _date(j['dob']),
      );
  final String id;
  final String phone;
  final Role role;
  final String? name;
  final String? email;
  final String? gender;
  final DateTime? dob;
}

class FamilyMember {
  const FamilyMember(
      {required this.id,
      required this.name,
      required this.relation,
      this.gender,
      this.dob});
  factory FamilyMember.fromJson(Json j) => FamilyMember(
        id: j['id'] as String,
        name: j['name'] as String,
        relation: j['relation'] as String,
        gender: j['gender'] as String?,
        dob: _date(j['dob']),
      );
  final String id;
  final String name;
  final String relation;
  final String? gender;
  final DateTime? dob;
}

// ---- doctors & appointments ----

class DoctorProfile {
  const DoctorProfile({
    required this.id,
    required this.isVerified,
    required this.price,
    this.name,
    this.hprId,
    this.medicalStream,
    this.specialization,
  });
  factory DoctorProfile.fromJson(Json j) => DoctorProfile(
        id: j['id'] as String,
        name: j['name'] as String?,
        hprId: j['hprId'] as String?,
        medicalStream: j['medicalStream'] == null
            ? null
            : MedicalStream.parse(j['medicalStream'] as String),
        specialization: j['specialization'] as String?,
        isVerified: j['isVerified'] as bool,
        price: Price.fromJson(j['price'] as Json),
      );
  final String id;
  final String? name;

  /// Already formatted "71-1234-5678-9012".
  final String? hprId;
  final MedicalStream? medicalStream;
  final String? specialization;
  final bool isVerified;
  final Price price;
}

class AvailabilityDay {
  const AvailabilityDay(
      {required this.dayOfWeek,
      required this.startTime,
      required this.endTime,
      this.slotMins = 15});
  factory AvailabilityDay.fromJson(Json j) => AvailabilityDay(
        dayOfWeek: j['dayOfWeek'] as int,
        startTime: j['startTime'] as String,
        endTime: j['endTime'] as String,
        slotMins: j['slotMins'] as int,
      );

  /// 0 = Sunday … 6 = Saturday.
  final int dayOfWeek;

  /// "HH:MM", 24-hour.
  final String startTime;
  final String endTime;
  final int slotMins;
  Json toJson() => {
        'dayOfWeek': dayOfWeek,
        'startTime': startTime,
        'endTime': endTime,
        'slotMins': slotMins
      };
}

class SlotDay {
  const SlotDay({required this.price, required this.slots});
  factory SlotDay.fromJson(Json j) => SlotDay(
        price: Price.fromJson(j['price'] as Json),
        slots: (j['slots'] as List).cast<String>(),
      );
  final Price price;

  /// Open slots as "HH:MM".
  final List<String> slots;
}

class Appointment {
  const Appointment({
    required this.id,
    required this.doctorId,
    required this.slot,
    required this.date,
    required this.status,
    required this.price,
    this.patient,
  });
  factory Appointment.fromJson(Json j) => Appointment(
        id: j['id'] as String,
        doctorId: j['doctorId'] as String,
        slot: j['slot'] as String,
        date: DateTime.parse(j['date'] as String),
        status: AppointmentStatus.parse(j['status'] as String?),
        price: _priceOf(j),
        patient:
            j['user'] == null ? null : PersonRef.fromJson(j['user'] as Json),
      );
  final String id;
  final String doctorId;
  final String slot;
  final DateTime date;
  final AppointmentStatus status;
  final Price price;

  /// Set on the doctor's schedule.
  final PersonRef? patient;
}

class RatingEntry {
  const RatingEntry(
      {required this.stars, required this.createdAt, this.comment, this.name});
  factory RatingEntry.fromJson(Json j) => RatingEntry(
        stars: j['stars'] as int,
        comment: j['comment'] as String?,
        createdAt: DateTime.parse(j['createdAt'] as String),
        name: j['name'] as String?,
      );
  final int stars;
  final String? comment;
  final String? name;
  final DateTime createdAt;
}

class RatingSummary {
  const RatingSummary(
      {required this.count, required this.ratings, this.average});
  factory RatingSummary.fromJson(Json j) => RatingSummary(
        average: (j['average'] as num?)?.toDouble(),
        count: j['count'] as int,
        ratings: _list(j['ratings'], RatingEntry.fromJson),
      );
  final double? average;
  final int count;
  final List<RatingEntry> ratings;
}

// ---- payments ----

/// A Razorpay order to open Checkout with. Amount is in paise.
class PaymentOrder {
  const PaymentOrder(
      {required this.orderId,
      required this.amountPaise,
      required this.currency,
      this.keyId});
  factory PaymentOrder.fromJson(Json j) => PaymentOrder(
        orderId: j['orderId'] as String,
        amountPaise: j['amountPaise'] as int,
        currency: j['currency'] as String,
        keyId: j['keyId'] as String?,
      );
  final String orderId;
  final int amountPaise;
  final String currency;

  /// Razorpay key id for Checkout; null when the server runs without a gateway (dev).
  final String? keyId;
}

class PaymentResult {
  const PaymentResult(
      {required this.status, required this.purpose, required this.refId});
  factory PaymentResult.fromJson(Json j) => PaymentResult(
        status: j['status'] as String,
        purpose: PaymentPurpose.parse(j['purpose'] as String?),
        refId: j['refId'] as String,
      );
  final String status;
  final PaymentPurpose purpose;
  final String refId;
  bool get paid => status == 'PAID';
}

// ---- labs ----

class LabProfile {
  const LabProfile({required this.id, required this.name, this.city});
  factory LabProfile.fromJson(Json j) => LabProfile(
      id: j['id'] as String,
      name: j['name'] as String,
      city: j['city'] as String?);
  final String id;
  final String name;
  final String? city;
}

class LabTest {
  const LabTest(
      {required this.id,
      required this.labId,
      required this.type,
      required this.name,
      required this.pricePaise});
  factory LabTest.fromJson(Json j) => LabTest(
        id: j['id'] as String,
        labId: j['labId'] as String,
        type: LabTestType.parse(j['type'] as String?),
        name: j['name'] as String,
        pricePaise: j['pricePaise'] as int,
      );
  final String id;
  final String labId;
  final LabTestType type;
  final String name;
  final int pricePaise;
  Price get price => Price.of(pricePaise);
}

class LabBooking {
  const LabBooking({
    required this.id,
    required this.labId,
    required this.testId,
    required this.status,
    required this.price,
    this.reportUrl,
    this.test,
    this.patient,
  });
  factory LabBooking.fromJson(Json j) => LabBooking(
        id: j['id'] as String,
        labId: j['labId'] as String,
        testId: j['testId'] as String,
        status: LabStatus.parse(j['status'] as String?),
        price: _priceOf(j),
        reportUrl: j['reportUrl'] as String?,
        test: j['test'] == null ? null : LabTest.fromJson(j['test'] as Json),
        patient:
            j['user'] == null ? null : PersonRef.fromJson(j['user'] as Json),
      );
  final String id;
  final String labId;
  final String testId;
  final LabStatus status;
  final Price price;
  final String? reportUrl;
  final LabTest? test;
  final PersonRef? patient;
}

// ---- pharma ----

class PharmaProfile {
  const PharmaProfile({required this.id, required this.name, this.city});
  factory PharmaProfile.fromJson(Json j) => PharmaProfile(
      id: j['id'] as String,
      name: j['name'] as String,
      city: j['city'] as String?);
  final String id;
  final String name;
  final String? city;
}

class PharmaItem {
  const PharmaItem(
      {required this.id,
      required this.name,
      required this.unitPricePaise,
      required this.stock});
  factory PharmaItem.fromJson(Json j) => PharmaItem(
        id: j['id'] as String,
        name: j['name'] as String,
        unitPricePaise: j['unitPricePaise'] as int,
        stock: j['stock'] as int,
      );
  final String id;
  final String name;
  final int unitPricePaise;
  final int stock;
}

/// One line of an order. [unitPricePaise] is only set once the pharmacy has quoted.
class OrderLine {
  const OrderLine({required this.name, required this.qty, this.unitPricePaise});
  factory OrderLine.fromJson(Json j) => OrderLine(
      name: j['name'] as String,
      qty: j['qty'] as int,
      unitPricePaise: j['unitPricePaise'] as int?);
  final String name;
  final int qty;
  final int? unitPricePaise;
  Json toJson() => {
        'name': name,
        'qty': qty,
        if (unitPricePaise != null) 'unitPricePaise': unitPricePaise
      };
}

class PharmaOrder {
  const PharmaOrder({
    required this.id,
    required this.pharmaId,
    required this.status,
    required this.items,
    required this.totalPaise,
    required this.createdAt,
    this.quotedItems,
    this.patient,
  });
  factory PharmaOrder.fromJson(Json j) => PharmaOrder(
        id: j['id'] as String,
        pharmaId: j['pharmaId'] as String,
        status: OrderStatus.parse(j['status'] as String?),
        items: _list(j['items'], OrderLine.fromJson),
        quotedItems: j['quotedItems'] == null
            ? null
            : _list(j['quotedItems'], OrderLine.fromJson),
        totalPaise: j['totalPaise'] as int,
        createdAt: DateTime.parse(j['createdAt'] as String),
        patient:
            j['user'] == null ? null : PersonRef.fromJson(j['user'] as Json),
      );
  final String id;
  final String pharmaId;
  final OrderStatus status;
  final List<OrderLine> items;
  final List<OrderLine>? quotedItems;

  /// Quoted subtotal (0 until quoted). The patient pays [payable].
  final int totalPaise;
  final DateTime createdAt;
  final PersonRef? patient;
  Price get payable => Price.of(totalPaise);
}

// ---- staff (home visits) ----

class StaffService {
  const StaffService({required this.type, required this.pricePaise});
  factory StaffService.fromJson(Json j) => StaffService(
      type: ServiceType.parse(j['type'] as String?),
      pricePaise: j['pricePaise'] as int);
  final ServiceType type;
  final int pricePaise;
  Json toJson() => {'type': type.wire, 'pricePaise': pricePaise};
}

class StaffProfile {
  const StaffProfile(
      {required this.id,
      required this.name,
      required this.services,
      this.city});
  factory StaffProfile.fromJson(Json j) => StaffProfile(
        id: j['id'] as String,
        name: j['name'] as String,
        city: j['city'] as String?,
        services: _list(j['services'], StaffService.fromJson),
      );
  final String id;
  final String name;
  final String? city;
  final List<StaffService> services;
}

class StaffVisit {
  const StaffVisit({
    required this.id,
    required this.staffId,
    required this.serviceType,
    required this.address,
    required this.scheduledAt,
    required this.status,
    required this.price,
    this.patient,
  });
  factory StaffVisit.fromJson(Json j) => StaffVisit(
        id: j['id'] as String,
        staffId: j['staffId'] as String,
        serviceType: ServiceType.parse(j['serviceType'] as String?),
        address: j['address'] as String,
        scheduledAt: DateTime.parse(j['scheduledAt'] as String),
        status: VisitStatus.parse(j['status'] as String?),
        price: _priceOf(j),
        patient:
            j['user'] == null ? null : PersonRef.fromJson(j['user'] as Json),
      );
  final String id;
  final String staffId;
  final ServiceType serviceType;
  final String address;
  final DateTime scheduledAt;
  final VisitStatus status;
  final Price price;
  final PersonRef? patient;
}

// ---- records, content, notifications ----

class HealthRecord {
  const HealthRecord(
      {required this.id,
      required this.title,
      required this.kind,
      required this.createdAt,
      this.data});
  factory HealthRecord.fromJson(Json j) => HealthRecord(
        id: j['id'] as String,
        title: j['title'] as String,
        kind: j['kind'] as String,
        data: j['data'] as Json?,
        createdAt: DateTime.parse(j['createdAt'] as String),
      );
  final String id;
  final String title;

  /// prescription | lab_report | vitals | allergy | note | other
  final String kind;
  final Json? data;
  final DateTime createdAt;
}

class Article {
  const Article({
    required this.id,
    required this.title,
    required this.body,
    required this.status,
    required this.createdAt,
    this.moderationNote,
    this.authorName,
    this.authorRole,
  });
  factory Article.fromJson(Json j) {
    final a = j['author'] as Json?;
    return Article(
      id: j['id'] as String,
      title: j['title'] as String,
      body: j['body'] as String,
      status: ArticleStatus.parse(j['status'] as String?),
      moderationNote: j['moderationNote'] as String?,
      authorName: a?['name'] as String?,
      authorRole: a == null ? null : Role.parse(a['role'] as String?),
      createdAt: DateTime.parse(j['createdAt'] as String),
    );
  }
  final String id;
  final String title;
  final String body;
  final ArticleStatus status;

  /// Why a rejected article was rejected.
  final String? moderationNote;
  final String? authorName;
  final Role? authorRole;
  final DateTime createdAt;
}

class AppNotification {
  const AppNotification(
      {required this.id,
      required this.title,
      required this.body,
      required this.read,
      required this.createdAt});
  factory AppNotification.fromJson(Json j) => AppNotification(
        id: j['id'] as String,
        title: j['title'] as String,
        body: j['body'] as String,
        read: j['read'] as bool,
        createdAt: DateTime.parse(j['createdAt'] as String),
      );
  final String id;
  final String title;
  final String body;
  final bool read;
  final DateTime createdAt;
}

class NotificationPage {
  const NotificationPage({required this.unreadCount, required this.items});
  factory NotificationPage.fromJson(Json j) => NotificationPage(
        unreadCount: j['unreadCount'] as int,
        items: _list(j['items'], AppNotification.fromJson),
      );
  final int unreadCount;
  final List<AppNotification> items;
}

// ---- AI ----

class SymptomResult {
  const SymptomResult({
    required this.urgency,
    required this.possibleConditions,
    required this.suggestedSpecialization,
    required this.advice,
    required this.disclaimer,
    required this.fromRules,
  });
  factory SymptomResult.fromJson(Json j) => SymptomResult(
        urgency: Urgency.parse(j['urgency'] as String?),
        possibleConditions: (j['possibleConditions'] as List).cast<String>(),
        suggestedSpecialization: j['suggestedSpecialization'] as String,
        advice: j['advice'] as String,
        disclaimer: j['disclaimer'] as String,
        fromRules: j['source'] == 'rules',
      );
  final Urgency urgency;
  final List<String> possibleConditions;
  final String suggestedSpecialization;
  final String advice;
  final String disclaimer;

  /// True for the built-in emergency check (no AI involved).
  final bool fromRules;
}

class DrugInteraction {
  const DrugInteraction(
      {required this.drugs, required this.severity, required this.description});
  factory DrugInteraction.fromJson(Json j) => DrugInteraction(
        drugs: (j['drugs'] as List).cast<String>(),
        severity: j['severity'] as String,
        description: (j['description'] ?? '') as String,
      );
  final List<String> drugs;

  /// minor | moderate | major
  final String severity;
  final String description;
}

class InteractionResult {
  const InteractionResult(
      {required this.interactions,
      required this.summary,
      required this.disclaimer});
  factory InteractionResult.fromJson(Json j) => InteractionResult(
        interactions: _list(j['interactions'], DrugInteraction.fromJson),
        summary: j['summary'] as String,
        disclaimer: j['disclaimer'] as String,
      );
  final List<DrugInteraction> interactions;
  final String summary;
  final String disclaimer;
}

// ---- students & referrals ----

class Course {
  const Course(
      {required this.id,
      required this.title,
      required this.lessons,
      this.description,
      this.stream});
  factory Course.fromJson(Json j) => Course(
        id: j['id'] as String,
        title: j['title'] as String,
        description: j['description'] as String?,
        stream: j['stream'] == null
            ? null
            : MedicalStream.parse(j['stream'] as String),
        lessons: j['lessons'] as int,
      );
  final String id;
  final String title;
  final String? description;
  final MedicalStream? stream;
  final int lessons;
}

class Enrollment {
  const Enrollment(
      {required this.id,
      required this.courseId,
      required this.progress,
      this.course});
  factory Enrollment.fromJson(Json j) => Enrollment(
        id: j['id'] as String,
        courseId: j['courseId'] as String,
        progress: j['progress'] as int,
        course:
            j['course'] == null ? null : Course.fromJson(j['course'] as Json),
      );
  final String id;
  final String courseId;

  /// Lessons completed.
  final int progress;
  final Course? course;
}

class Referral {
  const Referral(
      {required this.id,
      required this.phone,
      required this.joined,
      required this.createdAt});
  factory Referral.fromJson(Json j) => Referral(
        id: j['id'] as String,
        phone: j['phone'] as String,
        joined: (j['joined'] ?? false) as bool,
        createdAt: DateTime.parse(j['createdAt'] as String),
      );
  final String id;
  final String phone;

  /// The referred person has signed up.
  final bool joined;
  final DateTime createdAt;
}
