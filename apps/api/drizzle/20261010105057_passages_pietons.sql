CREATE TABLE "passage_pieton" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"geom" geometry(LineString, 4326) NOT NULL,
	"type" "traversee_pieton" DEFAULT 'marquee' NOT NULL,
	"troncons" uuid[] DEFAULT '{}' NOT NULL,
	"feux" uuid[] DEFAULT '{}' NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "branche" ADD COLUMN "passage_id" uuid;--> statement-breakpoint
CREATE INDEX "passage_pieton_geom_idx" ON "passage_pieton" USING gist ("geom");--> statement-breakpoint
ALTER TABLE "branche" ADD CONSTRAINT "branche_passage_id_passage_pieton_id_fk" FOREIGN KEY ("passage_id") REFERENCES "public"."passage_pieton"("id") ON DELETE set null ON UPDATE no action;