import '../api_client.dart';
import '../models.dart';

/// Pharmacies and medicine orders: patient side and the pharmacy app.
class PharmaApi {
  PharmaApi(this._c);
  final ApiClient _c;

  // ---- patient ----

  Future<List<PharmaProfile>> pharmacies() async =>
      (await _c.get('/pharma') as List)
          .map((e) => PharmaProfile.fromJson(e as Json))
          .toList();

  /// In-stock items only.
  Future<List<PharmaItem>> inventoryOf(String pharmaId) async =>
      (await _c.get('/pharma/$pharmaId/inventory') as List)
          .map((e) => PharmaItem.fromJson(e as Json))
          .toList();

  /// Requested -> the pharmacy quotes -> the patient pays.
  Future<PharmaOrder> requestOrder(
          String pharmaId, List<OrderLine> items) async =>
      PharmaOrder.fromJson(await _c.post('/pharma-orders', body: {
        'pharmaId': pharmaId,
        'items': items.map((i) => {'name': i.name, 'qty': i.qty}).toList()
      }) as Json);

  Future<List<PharmaOrder>> myOrders() async =>
      (await _c.get('/pharma-orders/my') as List)
          .map((e) => PharmaOrder.fromJson(e as Json))
          .toList();

  Future<PharmaOrder> order(String id) async =>
      PharmaOrder.fromJson(await _c.get('/pharma-orders/$id') as Json);

  /// Only for a quoted order; the amount includes the 2% MDR.
  Future<PaymentOrder> pay(String orderId) async => PaymentOrder.fromJson(
      await _c.post('/pharma-orders/$orderId/pay') as Json);

  Future<PharmaOrder> cancel(String id) async =>
      PharmaOrder.fromJson(await _c.patch('/pharma-orders/$id/cancel') as Json);

  // ---- pharmacy ----

  Future<PharmaProfile> saveProfile(
          {required String name, String? city}) async =>
      PharmaProfile.fromJson(await _c.put('/pharma/profile',
          body: {'name': name, if (city != null) 'city': city}) as Json);

  Future<PharmaProfile> myProfile() async =>
      PharmaProfile.fromJson(await _c.get('/pharma/profile') as Json);

  Future<List<PharmaItem>> myInventory() async =>
      (await _c.get('/pharma/inventory') as List)
          .map((e) => PharmaItem.fromJson(e as Json))
          .toList();

  Future<PharmaItem> addItem(
          {required String name,
          required int unitPricePaise,
          required int stock}) async =>
      PharmaItem.fromJson(await _c.post('/pharma/inventory', body: {
        'name': name,
        'unitPricePaise': unitPricePaise,
        'stock': stock
      }) as Json);

  Future<PharmaItem> updateItem(String id,
          {int? unitPricePaise, int? stock}) async =>
      PharmaItem.fromJson(await _c.patch('/pharma/inventory/$id', body: {
        if (unitPricePaise != null) 'unitPricePaise': unitPricePaise,
        if (stock != null) 'stock': stock,
      }) as Json);

  Future<void> deleteItem(String id) async =>
      _c.delete('/pharma/inventory/$id');

  Future<List<PharmaOrder>> incoming() async =>
      (await _c.get('/pharma-orders/incoming') as List)
          .map((e) => PharmaOrder.fromJson(e as Json))
          .toList();

  /// Every line needs a unit price (max ₹50,000). The patient has 24 hours to pay.
  Future<PharmaOrder> quote(String id, List<OrderLine> items) async =>
      PharmaOrder.fromJson(await _c.post('/pharma-orders/$id/quote',
          body: {'items': items.map((i) => i.toJson()).toList()}) as Json);

  Future<PharmaOrder> reject(String id) async =>
      PharmaOrder.fromJson(await _c.post('/pharma-orders/$id/reject') as Json);

  /// "ready" then "completed", after payment.
  Future<PharmaOrder> setStatus(String id, {required bool ready}) async =>
      PharmaOrder.fromJson(await _c.patch('/pharma-orders/$id/status',
          body: {'status': ready ? 'ready' : 'completed'}) as Json);
}
