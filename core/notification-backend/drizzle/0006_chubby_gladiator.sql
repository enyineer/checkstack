CREATE TABLE "notification_resource_parents" (
	"child_target_type_id" text NOT NULL,
	"child_resource_key" text NOT NULL,
	"parent_target_type_id" text NOT NULL,
	"parent_resource_key" text NOT NULL,
	CONSTRAINT "notification_resource_parents_child_target_type_id_child_resource_key_parent_target_type_id_parent_resource_key_pk" PRIMARY KEY("child_target_type_id","child_resource_key","parent_target_type_id","parent_resource_key")
);
--> statement-breakpoint
CREATE TABLE "notification_resources" (
	"target_type_id" text NOT NULL,
	"resource_key" text NOT NULL,
	"display_label" text NOT NULL,
	"upserted_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notification_resources_target_type_id_resource_key_pk" PRIMARY KEY("target_type_id","resource_key")
);
--> statement-breakpoint
CREATE TABLE "notification_targets" (
	"target_type_id" text PRIMARY KEY NOT NULL,
	"owner_plugin" text NOT NULL,
	"resource_kind" text NOT NULL,
	"parent_target_type_id" text,
	"legacy_group_id_template" text,
	"registered_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_migrations" (
	"spec_id" text NOT NULL,
	"resource_key" text NOT NULL,
	"migrated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_migrations_spec_id_resource_key_pk" PRIMARY KEY("spec_id","resource_key")
);
--> statement-breakpoint
CREATE TABLE "subscription_specs" (
	"spec_id" text PRIMARY KEY NOT NULL,
	"owner_plugin" text NOT NULL,
	"local_id" text NOT NULL,
	"target_type_id" text NOT NULL,
	"display_title" text NOT NULL,
	"display_description" text NOT NULL,
	"display_icon_name" text,
	"registered_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_resources" ADD CONSTRAINT "notification_resources_target_type_id_notification_targets_target_type_id_fk" FOREIGN KEY ("target_type_id") REFERENCES "notification_targets"("target_type_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_specs" ADD CONSTRAINT "subscription_specs_target_type_id_notification_targets_target_type_id_fk" FOREIGN KEY ("target_type_id") REFERENCES "notification_targets"("target_type_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_resource_parents_child_idx" ON "notification_resource_parents" USING btree ("child_target_type_id","child_resource_key");