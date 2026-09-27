CREATE TABLE "top_synchro" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"carrefour_id" uuid NOT NULL,
	"ligne" text NOT NULL,
	"instant" timestamp with time zone NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "top_synchro" ADD CONSTRAINT "top_synchro_carrefour_id_carrefour_id_fk" FOREIGN KEY ("carrefour_id") REFERENCES "public"."carrefour"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "top_synchro_carrefour_idx" ON "top_synchro" USING btree ("carrefour_id","instant");