CREATE TABLE "ligne_feux_feu" (
	"ligne_feux_id" uuid NOT NULL,
	"feu_id" uuid NOT NULL,
	CONSTRAINT "ligne_feux_feu_ligne_feux_id_feu_id_pk" PRIMARY KEY("ligne_feux_id","feu_id")
);
--> statement-breakpoint
ALTER TABLE "carrefour" ADD COLUMN "conflits_admis" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ligne_feux_feu" ADD CONSTRAINT "ligne_feux_feu_ligne_feux_id_ligne_feux_id_fk" FOREIGN KEY ("ligne_feux_id") REFERENCES "public"."ligne_feux"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ligne_feux_feu" ADD CONSTRAINT "ligne_feux_feu_feu_id_feu_id_fk" FOREIGN KEY ("feu_id") REFERENCES "public"."feu"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ligne_feux" DROP COLUMN "branche_code";--> statement-breakpoint
ALTER TABLE "ligne_feux" DROP COLUMN "voies";--> statement-breakpoint
ALTER TABLE "ligne_feux" DROP COLUMN "geom";