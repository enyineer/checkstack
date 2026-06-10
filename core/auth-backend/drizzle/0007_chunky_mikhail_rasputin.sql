CREATE TABLE "relation_tuple" (
	"object_type" text NOT NULL,
	"object_id" text NOT NULL,
	"relation" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "relation_tuple_object_type_object_id_relation_subject_type_subject_id_pk" PRIMARY KEY("object_type","object_id","relation","subject_type","subject_id")
);
--> statement-breakpoint
CREATE INDEX "relation_tuple_by_subject" ON "relation_tuple" USING btree ("subject_type","subject_id","object_type","relation");--> statement-breakpoint
CREATE INDEX "relation_tuple_by_type_relation" ON "relation_tuple" USING btree ("object_type","relation","subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "relation_tuple_owner_unique" ON "relation_tuple" USING btree ("object_type","object_id") WHERE "relation_tuple"."relation" = 'owner' AND "relation_tuple"."subject_type" = 'team';