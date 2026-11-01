CREATE TYPE "public"."statut_demande_role" AS ENUM('en_attente', 'accorde', 'refuse');--> statement-breakpoint
CREATE TYPE "public"."type_jeton_utilisateur" AS ENUM('verification_email', 'reinitialisation_mdp');--> statement-breakpoint
CREATE TABLE "jeton_utilisateur" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"utilisateur_id" uuid NOT NULL,
	"type" "type_jeton_utilisateur" NOT NULL,
	"hash" text NOT NULL,
	"expire_le" timestamp with time zone NOT NULL,
	"utilise_le" timestamp with time zone,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jeton_utilisateur_hash_unique" UNIQUE("hash")
);
--> statement-breakpoint
CREATE TABLE "utilisateur" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"nom" text NOT NULL,
	"mot_de_passe" text,
	"google_id" text,
	"email_verifie_le" timestamp with time zone,
	"actif" boolean DEFAULT true NOT NULL,
	"version_jeton" integer DEFAULT 0 NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"derniere_connexion_le" timestamp with time zone,
	CONSTRAINT "utilisateur_email_unique" UNIQUE("email"),
	CONSTRAINT "utilisateur_google_id_unique" UNIQUE("google_id")
);
--> statement-breakpoint
CREATE TABLE "utilisateur_role" (
	"utilisateur_id" uuid NOT NULL,
	"role" text NOT NULL,
	"statut" "statut_demande_role" NOT NULL,
	"motivation" text,
	"decide_par" uuid,
	"decide_le" timestamp with time zone,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "utilisateur_role_utilisateur_id_role_pk" PRIMARY KEY("utilisateur_id","role")
);
--> statement-breakpoint
ALTER TABLE "jeton_utilisateur" ADD CONSTRAINT "jeton_utilisateur_utilisateur_id_utilisateur_id_fk" FOREIGN KEY ("utilisateur_id") REFERENCES "public"."utilisateur"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utilisateur_role" ADD CONSTRAINT "utilisateur_role_utilisateur_id_utilisateur_id_fk" FOREIGN KEY ("utilisateur_id") REFERENCES "public"."utilisateur"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utilisateur_role" ADD CONSTRAINT "utilisateur_role_decide_par_utilisateur_id_fk" FOREIGN KEY ("decide_par") REFERENCES "public"."utilisateur"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jeton_utilisateur_utilisateur_idx" ON "jeton_utilisateur" USING btree ("utilisateur_id","type");--> statement-breakpoint
CREATE INDEX "utilisateur_role_statut_idx" ON "utilisateur_role" USING btree ("statut");--> statement-breakpoint
-- Ajout manuel : compte admin par défaut, sans mot de passe. Il se connecte par Google (même
-- e-mail, fusion automatique) ou définit un mot de passe par « Mot de passe oublié ».
INSERT INTO "utilisateur" ("email", "nom", "email_verifie_le")
VALUES ('estebangagneur03@gmail.com', 'Esteban', now())
ON CONFLICT ("email") DO NOTHING;--> statement-breakpoint
INSERT INTO "utilisateur_role" ("utilisateur_id", "role", "statut", "decide_le")
SELECT "id", 'admin', 'accorde', now() FROM "utilisateur" WHERE "email" = 'estebangagneur03@gmail.com'
ON CONFLICT DO NOTHING;
