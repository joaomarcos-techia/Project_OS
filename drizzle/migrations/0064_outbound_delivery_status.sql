-- 0064 - Estado real de entrega das mensagens outbound

ALTER TYPE outbound_status ADD VALUE IF NOT EXISTS 'sent' AFTER 'accepted';
--> statement-breakpoint
ALTER TYPE outbound_status ADD VALUE IF NOT EXISTS 'delivered' AFTER 'sent';
--> statement-breakpoint
ALTER TYPE outbound_status ADD VALUE IF NOT EXISTS 'read' AFTER 'delivered';
--> statement-breakpoint

ALTER TABLE outbound_messages ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
--> statement-breakpoint
ALTER TABLE outbound_messages ADD COLUMN IF NOT EXISTS read_at timestamptz;
--> statement-breakpoint
ALTER TABLE outbound_messages ADD COLUMN IF NOT EXISTS failed_at timestamptz;
--> statement-breakpoint
ALTER TABLE outbound_messages ADD COLUMN IF NOT EXISTS status_updated_at timestamptz;
--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('0064-outbound-delivery-status')
ON CONFLICT (version) DO NOTHING;
