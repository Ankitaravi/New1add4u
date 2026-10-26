/// Money is always integer paise (100 paise = ₹1).
const int mdrPercent = 2;
const int maxUnitPricePaise = 5000000; // ₹50,000

/// What the patient pays: provider fee + 2% MDR. Matches the backend's `priceOf`.
class Price {
  const Price(
      {required this.feePaise,
      required this.mdrPaise,
      required this.totalPaise});

  /// Computes the price for a fee, using the same rounding as the server.
  factory Price.of(int feePaise) {
    final mdr = (feePaise * mdrPercent / 100).round();
    return Price(feePaise: feePaise, mdrPaise: mdr, totalPaise: feePaise + mdr);
  }

  factory Price.fromJson(Map<String, dynamic> j) => Price(
        feePaise: j['feePaise'] as int,
        mdrPaise: j['mdrPaise'] as int,
        totalPaise: j['totalPaise'] as int,
      );

  final int feePaise;
  final int mdrPaise;
  final int totalPaise;

  @override
  bool operator ==(Object other) =>
      other is Price &&
      other.feePaise == feePaise &&
      other.mdrPaise == mdrPaise &&
      other.totalPaise == totalPaise;
  @override
  int get hashCode => Object.hash(feePaise, mdrPaise, totalPaise);
  @override
  String toString() => 'Price($feePaise + $mdrPaise = $totalPaise)';
}

/// 2350 -> "₹23.50", 251000 -> "₹2510". Whole rupees drop the decimals.
String rupees(int paise) {
  final r = paise ~/ 100;
  final p = paise % 100;
  return p == 0 ? '₹$r' : '₹$r.${p.toString().padLeft(2, '0')}';
}

/// An HPR ID is exactly 14 digits (hyphens allowed).
bool validHprId(String s) =>
    RegExp(r'^\d{14}$').hasMatch(s.replaceAll('-', ''));

/// "71123456789012" -> "71-1234-5678-9012"
String formatHprId(String digits) {
  final d = digits.replaceAll(RegExp(r'\D'), '');
  if (d.length != 14) return digits;
  return '${d.substring(0, 2)}-${d.substring(2, 6)}-${d.substring(6, 10)}-${d.substring(10, 14)}';
}

/// "2026-11-02" — the date format the booking endpoints expect.
String formatDay(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
