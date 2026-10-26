CREATE TABLE "agent_events" (
	"id" bigint PRIMARY KEY NOT NULL,
	"space_id" bigint NOT NULL,
	"session_id" bigint NOT NULL,
	"stream_id" text NOT NULL,
	"seq" bigint NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"task_id" bigint,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_message_node_bindings" (
	"id" bigint PRIMARY KEY NOT NULL,
	"space_id" bigint NOT NULL,
	"message_id" bigint NOT NULL,
	"node_id" bigint NOT NULL,
	"binding_kind" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_messages" (
	"id" bigint PRIMARY KEY NOT NULL,
	"space_id" bigint NOT NULL,
	"session_id" bigint NOT NULL,
	"role" smallint NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"content_type" smallint DEFAULT 1 NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"task_id" bigint,
	"seq" integer NOT NULL,
	"reaction" smallint DEFAULT 0 NOT NULL,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_sessions" (
	"id" bigint PRIMARY KEY NOT NULL,
	"space_id" bigint NOT NULL,
	"scope" smallint DEFAULT 1 NOT NULL,
	"canvas_id" bigint,
	"title" text DEFAULT '' NOT NULL,
	"status" smallint DEFAULT 1 NOT NULL,
	"last_read_seq" integer DEFAULT 0 NOT NULL,
	"created_by" bigint NOT NULL,
	"last_active_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "feedback" jsonb;--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_message_node_bindings" ADD CONSTRAINT "agent_message_node_bindings_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_message_node_bindings" ADD CONSTRAINT "agent_message_node_bindings_message_id_agent_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."agent_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_message_node_bindings" ADD CONSTRAINT "agent_message_node_bindings_node_id_canvas_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."canvas_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_canvas_id_canvases_id_fk" FOREIGN KEY ("canvas_id") REFERENCES "public"."canvases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_agent_events_stream" ON "agent_events" USING btree ("session_id","stream_id");--> statement-breakpoint
CREATE INDEX "idx_agent_events_replay" ON "agent_events" USING btree ("session_id","seq");--> statement-breakpoint
CREATE INDEX "idx_agent_events_expire" ON "agent_events" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_agent_msg_binding" ON "agent_message_node_bindings" USING btree ("message_id","node_id");--> statement-breakpoint
CREATE INDEX "idx_agent_bindings_node" ON "agent_message_node_bindings" USING btree ("node_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_agent_messages_seq" ON "agent_messages" USING btree ("session_id","seq");--> statement-breakpoint
CREATE INDEX "idx_agent_messages_session" ON "agent_messages" USING btree ("session_id","seq");--> statement-breakpoint
CREATE INDEX "idx_agent_sessions_space" ON "agent_sessions" USING btree ("space_id","scope","last_active_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_agent_sessions_canvas" ON "agent_sessions" USING btree ("canvas_id","last_active_at" DESC NULLS LAST);