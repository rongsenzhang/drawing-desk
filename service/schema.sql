CREATE TABLE IF NOT EXISTS scan_reservations (
    utc_day INTEGER NOT NULL,
    time_window INTEGER NOT NULL,
    client_hash TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS scan_day ON scan_reservations(utc_day);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS scan_client_window ON scan_reservations(time_window, client_hash);
