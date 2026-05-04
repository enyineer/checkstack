CREATE TABLE "user_tip_dismissal" (
	"user_id" text NOT NULL,
	"tip_id" text NOT NULL,
	"dismissed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_tip_dismissal_user_id_tip_id_pk" PRIMARY KEY("user_id","tip_id")
);
