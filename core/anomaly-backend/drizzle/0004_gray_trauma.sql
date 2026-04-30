CREATE TABLE "anomaly_notification_mutes" (
	"user_id" text NOT NULL,
	"system_id" text NOT NULL,
	"field_path" text NOT NULL,
	"muted_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "anomaly_notification_mutes_user_id_system_id_field_path_pk" PRIMARY KEY("user_id","system_id","field_path")
);
--> statement-breakpoint
CREATE INDEX "anomaly_notification_mutes_user_idx" ON "anomaly_notification_mutes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "anomaly_notification_mutes_system_idx" ON "anomaly_notification_mutes" USING btree ("system_id");