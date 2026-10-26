// Runs every service against a real backend. Skipped unless API_URL is set:
//   API_URL=http://localhost:3000 dart test test/integration_test.dart
// The backend must run in non-production mode (fixed OTP 123456, test payment secret)
// with the seed data loaded (`npm run seed` in backend/).
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:core/core.dart';
import 'package:crypto/crypto.dart';
import 'package:test/test.dart';

final baseUrl = Platform.environment['API_URL'];
final rng = Random();

String randomPhone() => '9${List.generate(9, (_) => rng.nextInt(10)).join()}';
String randomHpr() => '71${List.generate(12, (_) => rng.nextInt(10)).join()}';
final tag = DateTime.now().millisecondsSinceEpoch.toRadixString(36);

/// An [Api] acting as whoever owns [token].
Api as_(String token) => Api(baseUrl: baseUrl!, tokenProvider: () => token);

Future<Api> signUp(String phone) async {
  final anon = Api(baseUrl: baseUrl!);
  await anon.auth.sendOtp(phone);
  final r = await anon.auth.verifyOtp(phone, '123456');
  return as_(r.token);
}

/// What Razorpay Checkout would return for a paid order, signed with the dev secret.
String sign(String orderId, String paymentId) =>
    Hmac(sha256, utf8.encode('test_secret'))
        .convert(utf8.encode('$orderId|$paymentId'))
        .toString();

Future<PaymentResult> payOrder(Api api, PaymentOrder o) {
  final paymentId = 'pay_$tag${rng.nextInt(99999)}';
  return api.payments.verify(
      orderId: o.orderId,
      paymentId: paymentId,
      signature: sign(o.orderId, paymentId));
}

void main() {
  final skip = baseUrl == null ? 'Set API_URL to run integration tests' : false;
  final admin = baseUrl == null ? null : as_('admin_token_123');

  late Api patient;
  setUpAll(() async {
    if (baseUrl == null) return;
    patient = await signUp(randomPhone());
  });

  test('auth: OTP login, profile, family', () async {
    final anon = Api(baseUrl: baseUrl!);
    await expectLater(anon.auth.sendOtp('123'),
        throwsA(isA<ApiException>().having((e) => e.status, 'status', 400)));
    final phone = randomPhone();
    await anon.auth.sendOtp(phone);
    await expectLater(
        anon.auth.verifyOtp(phone, '000000'),
        throwsA(
            isA<ApiException>().having((e) => e.isUnauthorized, '401', true)));
    final r = await anon.auth.verifyOtp(phone, '123456');
    expect(r.user.role, Role.user);
    final me = as_(r.token);
    expect((await me.auth.me()).phone, phone);

    final updated = await me.auth.updateProfile(
        name: 'Ravi', gender: 'male', dob: DateTime.utc(1990, 5, 17));
    expect(updated.name, 'Ravi');
    expect(updated.dob!.year, 1990);
    final m = await me.auth.addFamilyMember(name: 'Asha', relation: 'mother');
    expect((await me.auth.family()).map((f) => f.name), ['Asha']);
    await me.auth.removeFamilyMember(m.id);
    expect(await me.auth.family(), isEmpty);

    await me.auth.logout();
    await expectLater(
        me.auth.me(),
        throwsA(
            isA<ApiException>().having((e) => e.isUnauthorized, '401', true)));
  }, skip: skip);

  test(
      'doctor registers, gets verified, patient books + pays, doctor completes, patient rates',
      () async {
    final spec = 'Spec$tag';
    final doctor = await signUp(randomPhone());
    final hpr = randomHpr();
    final reg = await doctor.doctors.register(
        hprId: formatHprId(hpr),
        medicalStream: MedicalStream.ayurveda,
        specialization: spec,
        feePaise: 50000);
    expect(reg.isVerified, isFalse);
    expect(reg.hprId, formatHprId(hpr));
    expect(reg.medicalStream, MedicalStream.ayurveda);

    // invisible until an admin verifies
    expect(await patient.doctors.search(specialization: spec), isEmpty);
    await admin!.client
        .patch('/admin/doctors/${reg.id}/verify', body: {'verified': true});
    final found = await patient.doctors
        .search(specialization: spec, stream: MedicalStream.ayurveda);
    expect(found.single.id, reg.id);
    expect(found.single.price.totalPaise, 51000);

    // a 14-digit HPR can only be registered once
    final other = await signUp(randomPhone());
    await expectLater(
        other.doctors.register(
            hprId: hpr,
            medicalStream: MedicalStream.mbbs,
            specialization: 'x',
            feePaise: 100),
        throwsA(isA<ApiException>().having((e) => e.isConflict, '409', true)));

    final day = DateTime.now().toUtc().add(const Duration(days: 4));
    final date = DateTime.utc(day.year, day.month, day.day);
    await doctor.doctors.setAvailability([
      AvailabilityDay(
          dayOfWeek: date.weekday % 7, startTime: '09:00', endTime: '10:00')
    ]);
    expect((await doctor.doctors.availability()).single.slotMins, 15);

    final slots = await patient.appointments.slots(reg.id, date);
    expect(slots.slots, ['09:00', '09:15', '09:30', '09:45']);
    expect(slots.price.totalPaise, 51000);

    final appt = await patient.appointments
        .book(doctorId: reg.id, date: date, slot: '09:00');
    expect(appt.status, AppointmentStatus.pendingPayment);
    expect(appt.price, slots.price);
    expect((await patient.appointments.slots(reg.id, date)).slots,
        isNot(contains('09:00')));
    final intruder = await signUp(randomPhone());
    await expectLater(
        intruder.appointments.book(doctorId: reg.id, date: date, slot: '09:00'),
        throwsA(isA<ApiException>().having((e) => e.isConflict, '409', true)));

    final order =
        await patient.payments.createOrder(PaymentPurpose.appointment, appt.id);
    expect(order.amountPaise, 51000);
    expect(order.currency, 'INR');
    await expectLater(
        patient.payments.verify(
            orderId: order.orderId, paymentId: 'pay_x', signature: 'forged'),
        throwsA(isA<ApiException>().having((e) => e.status, 'status', 400)));
    expect((await payOrder(patient, order)).paid, isTrue);
    expect((await patient.appointments.byId(appt.id)).status,
        AppointmentStatus.confirmed);

    final schedule = await doctor.doctors.schedule(date);
    expect(schedule.single.patient, isNotNull);
    expect(schedule.single.id, appt.id);
    await doctor.appointments.setStatus(appt.id, AppointmentStatus.inQueue);
    final done = await doctor.appointments
        .setStatus(appt.id, AppointmentStatus.completed);
    expect(done.status, AppointmentStatus.completed);

    await patient.doctors.rate(reg.id, 4, comment: 'Good');
    await patient.doctors.rate(reg.id, 5, comment: 'Great');
    final summary = await patient.doctors.ratings(reg.id);
    expect((summary.count, summary.average), (1, 5.0));

    // pay, then cancel -> refunded and the slot opens up again
    final second = await patient.appointments
        .book(doctorId: reg.id, date: date, slot: '09:15');
    await payOrder(
        patient,
        await patient.payments
            .createOrder(PaymentPurpose.appointment, second.id));
    expect((await patient.appointments.cancel(second.id)).status,
        AppointmentStatus.cancelled);
    expect((await patient.appointments.slots(reg.id, date)).slots,
        contains('09:15'));
    expect((await patient.appointments.mine()).map((a) => a.id),
        containsAll([appt.id, second.id]));
  }, skip: skip);

  test('lab: tests, booking, payment, report', () async {
    final lab = as_('lab_token_123');
    final profile = await lab.labs.saveProfile(name: 'Lab $tag', city: 'Delhi');
    final test = await lab.labs.addTest(
        type: LabTestType.hba1c, name: 'HbA1c $tag', pricePaise: 40000);
    await expectLater(
        lab.labs.addTest(
            type: LabTestType.cbc,
            name: 'too dear',
            pricePaise: maxUnitPricePaise + 1),
        throwsA(isA<ApiException>().having((e) => e.status, 'status', 400)));

    expect((await patient.labs.labs()).map((l) => l.id), contains(profile.id));
    final listed = (await patient.labs.testsOf(profile.id))
        .firstWhere((t) => t.id == test.id);
    expect(listed.type, LabTestType.hba1c);

    final booking = await patient.labs.book(test.id);
    expect(booking.price.totalPaise, 40800);
    expect((await lab.labs.incoming()).map((b) => b.id),
        isNot(contains(booking.id)));
    final order = await patient.labs.pay(booking.id);
    expect(order.amountPaise, 40800);
    await payOrder(patient, order);

    expect(
        (await lab.labs.incoming())
            .firstWhere((b) => b.id == booking.id)
            .patient,
        isNotNull);
    await lab.labs.setStatus(booking.id, LabStatus.sampleCollected);
    await expectLater(
        lab.labs.setStatus(booking.id, LabStatus.reportUploaded),
        throwsA(isA<ApiException>()
            .having((e) => e.status, 'status', 400))); // needs reportUrl
    await lab.labs.setStatus(booking.id, LabStatus.reportUploaded,
        reportUrl: 'https://files.example.com/r.pdf');
    await lab.labs.setStatus(booking.id, LabStatus.completed);
    final mine =
        (await patient.labs.myBookings()).firstWhere((b) => b.id == booking.id);
    expect((mine.status, mine.reportUrl, mine.test?.name),
        (LabStatus.completed, 'https://files.example.com/r.pdf', 'HbA1c $tag'));
  }, skip: skip);

  test('pharma: request, quote, pay, fulfil', () async {
    final pharma = as_('pharma_token_123');
    final shop =
        await pharma.pharma.saveProfile(name: 'Pharmacy $tag', city: 'Pune');
    final item = await pharma.pharma
        .addItem(name: 'Crocin $tag', unitPricePaise: 3000, stock: 10);
    expect((await patient.pharma.inventoryOf(shop.id)).map((i) => i.id),
        contains(item.id));

    final order = await patient.pharma.requestOrder(shop.id, const [
      OrderLine(name: 'ORS', qty: 2),
      OrderLine(name: 'Crocin', qty: 1)
    ]);
    expect(order.status, OrderStatus.requested);
    await expectLater(patient.pharma.pay(order.id),
        throwsA(isA<ApiException>().having((e) => e.status, 'status', 400)));

    final inbox = await pharma.pharma.incoming();
    expect(inbox.firstWhere((o) => o.id == order.id).patient, isNotNull);
    final quoted = await pharma.pharma.quote(order.id, const [
      OrderLine(name: 'ORS', qty: 2, unitPricePaise: 1500),
      OrderLine(name: 'Crocin', qty: 1, unitPricePaise: 2000),
    ]);
    expect((quoted.status, quoted.totalPaise, quoted.payable.totalPaise),
        (OrderStatus.quoted, 5000, 5100));

    final pay = await patient.pharma.pay(order.id);
    expect(pay.amountPaise, 5100);
    await payOrder(patient, pay);
    expect((await patient.pharma.order(order.id)).status, OrderStatus.paid);
    await pharma.pharma.setStatus(order.id, ready: true);
    expect((await pharma.pharma.setStatus(order.id, ready: false)).status,
        OrderStatus.completed);

    final rejected = await patient.pharma
        .requestOrder(shop.id, const [OrderLine(name: 'X', qty: 1)]);
    expect(
        (await pharma.pharma.reject(rejected.id)).status, OrderStatus.rejected);
  }, skip: skip);

  test('staff: services, home visit, payment, completion', () async {
    final nurse = as_('staff_token_123');
    final profile =
        await nurse.staff.saveProfile(name: 'Nurse $tag', city: 'City$tag');
    final services = await nurse.staff.setServices(const [
      StaffService(type: ServiceType.injection, pricePaise: 20000),
      StaffService(type: ServiceType.ivDrip, pricePaise: 50000),
    ]);
    expect(services.length, 2);
    expect(
        (await patient.staff
                .search(city: 'City$tag', service: ServiceType.ivDrip))
            .single
            .id,
        profile.id);
    expect(
        await patient.staff
            .search(city: 'City$tag', service: ServiceType.dressing),
        isEmpty);

    final visit = await patient.staff.bookVisit(
        staffId: profile.id,
        service: ServiceType.injection,
        address: '12 MG Road, Delhi',
        scheduledAt: DateTime.now().add(const Duration(days: 2)));
    expect(visit.price.totalPaise, 20400);
    await payOrder(patient, await patient.staff.pay(visit.id));
    expect((await nurse.staff.incoming()).map((v) => v.id), contains(visit.id));
    await nurse.staff.setStatus(visit.id, VisitStatus.inProgress);
    expect(
        (await nurse.staff.setStatus(visit.id, VisitStatus.completed)).status,
        VisitStatus.completed);
    expect((await patient.staff.visit(visit.id)).status, VisitStatus.completed);
  }, skip: skip);

  test('health records', () async {
    final r = await patient.records
        .add(title: 'BP $tag', kind: 'vitals', data: {'sys': 120, 'dia': 80});
    expect((await patient.records.list(kind: 'vitals')).map((x) => x.id),
        contains(r.id));
    expect((await patient.records.byId(r.id)).data!['sys'], 120);
    await expectLater(patient.records.add(title: 'x', kind: 'bogus'),
        throwsA(isA<ApiException>()));
    await patient.records.delete(r.id);
    await expectLater(patient.records.byId(r.id),
        throwsA(isA<ApiException>().having((e) => e.isNotFound, '404', true)));
  }, skip: skip);

  test('notifications: list, mark read, device tokens', () async {
    final page = await patient.notifications.list();
    expect(page.items, isNotEmpty); // payments above notified this patient
    expect(page.unreadCount, greaterThan(0));
    await patient.notifications.markRead(page.items.first.id);
    await patient.notifications.markAllRead();
    expect((await patient.notifications.list(unreadOnly: true)).items, isEmpty);
    await patient.notifications
        .registerDevice('fcm-token-$tag-aaaaaaaaaa', platform: 'android');
    await patient.notifications.unregisterDevice('fcm-token-$tag-aaaaaaaaaa');
  }, skip: skip);

  test('content: write -> moderate -> publish', () async {
    final student = as_('student_token_123');
    final a = await student.content.write(
        title: 'Study tips $tag',
        body: 'Revise the cardiac cycle with diagrams daily.');
    expect(a.status, ArticleStatus.pending);
    expect((await patient.content.articles(query: 'Study tips $tag')), isEmpty);
    await as_('hadmin_token_123').client.patch(
        '/content/articles/${a.id}/moderate',
        body: {'status': 'APPROVED'});
    final published = await patient.content.articles(query: 'Study tips $tag');
    expect(published.single.authorRole, Role.student);
    expect((await student.content.mine()).map((x) => x.id), contains(a.id));
  }, skip: skip);

  test('students: courses and progress', () async {
    final student = as_('student2_token');
    await student.students
        .saveProfile(college: 'AIIMS', stream: MedicalStream.mbbs);
    final course = Course.fromJson(await admin!.client.post('/students/courses',
            body: {'title': 'Anatomy $tag', 'stream': 'mbbs', 'lessons': 10})
        as Json);
    expect(
        (await student.students.courses(stream: MedicalStream.mbbs))
            .map((c) => c.id),
        contains(course.id));
    await student.students.enroll(course.id);
    await expectLater(student.students.enroll(course.id),
        throwsA(isA<ApiException>().having((e) => e.isConflict, '409', true)));
    await student.students.setProgress(course.id, 6);
    expect((await student.students.setProgress(course.id, 2)).progress,
        6); // never goes backwards
    final mine = (await student.students.myCourses())
        .firstWhere((e) => e.courseId == course.id);
    expect((mine.progress, mine.course?.lessons), (6, 10));
  }, skip: skip);

  test('referrals', () async {
    final friend = randomPhone();
    await patient.referrals.refer(friend);
    await expectLater(patient.referrals.refer(friend),
        throwsA(isA<ApiException>().having((e) => e.isConflict, '409', true)));
    expect(
        (await patient.referrals.mine())
            .firstWhere((r) => r.phone == friend)
            .joined,
        isFalse);
    await signUp(friend);
    expect(
        (await patient.referrals.mine())
            .firstWhere((r) => r.phone == friend)
            .joined,
        isTrue);
  }, skip: skip);

  test('AI: emergency rules work offline; unconfigured AI is a clean 503',
      () async {
    final e = await patient.ai.symptomCheck('severe chest pain and sweating');
    expect((e.urgency, e.fromRules), (Urgency.emergency, true));
    expect(e.advice, contains('112'));
    expect(e.disclaimer, isNotEmpty);
    // The backend under test has no ANTHROPIC_API_KEY.
    await expectLater(patient.ai.symptomCheck('mild headache since morning'),
        throwsA(isA<ApiException>().having((x) => x.status, 'status', 503)));
    await expectLater(patient.ai.drugInteraction(['aspirin', 'warfarin']),
        throwsA(isA<ApiException>().having((x) => x.status, 'status', 503)));
  }, skip: skip);

  test('role checks surface as 403', () async {
    await expectLater(patient.labs.incoming(),
        throwsA(isA<ApiException>().having((e) => e.isForbidden, '403', true)));
    await expectLater(patient.doctors.myProfile(),
        throwsA(isA<ApiException>().having((e) => e.isForbidden, '403', true)));
  }, skip: skip);
}
