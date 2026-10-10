CREATE TABLE "profil" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nom" text,
	"rue" jsonb NOT NULL,
	"largeur_m" real NOT NULL,
	"image_le" timestamp with time zone,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "troncon" ADD COLUMN "profil_theorique_id" uuid;--> statement-breakpoint
ALTER TABLE "troncon" ADD COLUMN "profil_inverse" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "troncon" ADD CONSTRAINT "troncon_profil_theorique_id_profil_id_fk" FOREIGN KEY ("profil_theorique_id") REFERENCES "public"."profil"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "troncon_profil_idx" ON "troncon" USING btree ("profil_theorique_id");