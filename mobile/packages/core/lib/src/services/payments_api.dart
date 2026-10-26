import '../api_client.dart';
import '../enums.dart';
import '../models.dart';

/// Razorpay flow: [createOrder] -> open Razorpay Checkout with the returned order -> [verify]
/// with the three values Checkout gives back. The server also settles via webhook, so a
/// paid order is confirmed even if the app dies before calling [verify].
class PaymentsApi {
  PaymentsApi(this._c);
  final ApiClient _c;

  Future<PaymentOrder> createOrder(
          PaymentPurpose purpose, String refId) async =>
      PaymentOrder.fromJson(await _c.post('/payments/create-order',
          body: {'purpose': purpose.wire, 'refId': refId}) as Json);

  Future<PaymentResult> verify(
          {required String orderId,
          required String paymentId,
          required String signature}) async =>
      PaymentResult.fromJson(await _c.post('/payments/verify', body: {
        'orderId': orderId,
        'paymentId': paymentId,
        'signature': signature
      }) as Json);
}
