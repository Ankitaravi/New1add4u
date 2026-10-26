-- A slot can be held by at most one live appointment; cancelled/expired/no-show free it.
CREATE UNIQUE INDEX "Appointment_live_slot_key"
  ON "Appointment" ("doctorId", "date", "slot")
  WHERE "status" IN ('PENDING_PAYMENT', 'CONFIRMED', 'IN_QUEUE', 'COMPLETED');
