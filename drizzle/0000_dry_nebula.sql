CREATE TABLE "care_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"plant_id" uuid NOT NULL,
	"session_id" uuid,
	"action" text NOT NULL,
	"occurred_on" date NOT NULL,
	"occurred_at" timestamp with time zone,
	"moisture" text DEFAULT 'unknown' NOT NULL,
	"notes" text,
	"source_cell" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	CONSTRAINT "event_action_valid" CHECK ("care_events"."action" IN ('watered','checked','skipped','water_changed','water_topped_up','legacy_water_care')),
	CONSTRAINT "event_moisture_valid" CHECK ("care_events"."moisture" IN ('unknown','dry','moist','wet'))
);
--> statement-breakpoint
CREATE TABLE "gardens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'Pacific/Auckland' NOT NULL,
	"location_name" text NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plant_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"garden_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plant_group_members" (
	"group_id" uuid NOT NULL,
	"plant_id" uuid NOT NULL,
	CONSTRAINT "plant_group_members_group_id_plant_id_pk" PRIMARY KEY("group_id","plant_id")
);
--> statement-breakpoint
CREATE TABLE "watering_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"garden_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"starts_on" date NOT NULL,
	"status" text NOT NULL,
	"input_snapshot" jsonb NOT NULL,
	"result" jsonb,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_mode_valid" CHECK ("watering_plans"."mode" IN ('history','ai')),
	CONSTRAINT "plan_status_valid" CHECK ("watering_plans"."status" IN ('generating','ready','failed'))
);
--> statement-breakpoint
CREATE TABLE "plants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"garden_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"moisture_preference" text,
	"watering_guidance" text,
	"light_preference" text,
	"status_label" text,
	"position_label" text,
	"natural_habitat" text,
	"profile" jsonb NOT NULL,
	"legacy_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "care_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"garden_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"occurred_on" date NOT NULL,
	"occurred_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "care_events" ADD CONSTRAINT "care_events_plant_id_plants_id_fk" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_events" ADD CONSTRAINT "care_events_session_id_care_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."care_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plant_groups" ADD CONSTRAINT "plant_groups_garden_id_gardens_id_fk" FOREIGN KEY ("garden_id") REFERENCES "public"."gardens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plant_group_members" ADD CONSTRAINT "plant_group_members_group_id_plant_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."plant_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plant_group_members" ADD CONSTRAINT "plant_group_members_plant_id_plants_id_fk" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watering_plans" ADD CONSTRAINT "watering_plans_garden_id_gardens_id_fk" FOREIGN KEY ("garden_id") REFERENCES "public"."gardens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plants" ADD CONSTRAINT "plants_garden_id_gardens_id_fk" FOREIGN KEY ("garden_id") REFERENCES "public"."gardens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_sessions" ADD CONSTRAINT "care_sessions_garden_id_gardens_id_fk" FOREIGN KEY ("garden_id") REFERENCES "public"."gardens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "care_history" ON "care_events" USING btree ("plant_id","occurred_on");--> statement-breakpoint
CREATE UNIQUE INDEX "session_plant_unique" ON "care_events" USING btree ("session_id","plant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "group_name_unique" ON "plant_groups" USING btree ("garden_id","name","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_request_unique" ON "watering_plans" USING btree ("garden_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_plan" ON "watering_plans" USING btree ("garden_id") WHERE "watering_plans"."status" = 'generating';--> statement-breakpoint
CREATE INDEX "recent_plans" ON "watering_plans" USING btree ("garden_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "plant_code_unique" ON "plants" USING btree ("garden_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "session_request_unique" ON "care_sessions" USING btree ("garden_id","request_id");