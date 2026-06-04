-- Add outcome field to lead_follow_ups table
ALTER TABLE lead_follow_ups
  ADD COLUMN outcome VARCHAR(50) DEFAULT NULL
  AFTER type;
